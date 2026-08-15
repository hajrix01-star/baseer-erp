import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const { Pool } = pg;
const baseUrl = 'http://127.0.0.1:5298/v1';
const gatePassword = 'GateB-Baseer-ERP-Only-2026!';
const pool = new Pool({ connectionString: requiredEnvironment('DATABASE_URL') });

const tenantA = fixtureTenant('gate-b-a');
const tenantB = fixtureTenant('gate-b-b');
const fixture = {
  tenantA,
  tenantB,
  userA: randomUUID(),
  userB: randomUUID(),
  companyA: randomUUID(),
  companyB: randomUUID(),
  roleA: randomUUID(),
  roleB: randomUUID(),
};

let database;
let child;

try {
  await seedFixture();
  await verifyRlsIsolation();

  child = startApi();
  await waitForApi();

  const session = await signIn();
  await verifySafeFailedSignIn();
  await verifyLiveCompanyAuthorization(session.accessToken);
  await verifyBusinessDate(session.accessToken);
  await verifyFinanceHttpBoundaries(session.accessToken);
  await verifyOutputPlatform(session.accessToken);
  const fileMetadataId = await verifyFileMetadata(session.accessToken);
  await verifyObservability(session.accessToken);
  const revokedAccessToken = await verifyRefreshRotationAndReplay(session.refreshToken);
  await verifyOutputRevocation(revokedAccessToken);
  await verifyFileMetadataRevocation(revokedAccessToken, fileMetadataId);
  await verifyObservabilityRevocation(revokedAccessToken);
  await verifySignOut();

  await verifyAuditRollback();
  await verifyIdempotency();
  await verifyConcurrentSerials();

  process.stdout.write('Gate B database verification passed: RLS, identity, authorization, business date, Finance HTTP boundary, output, file metadata, observability, audit, idempotency, and serial allocation.\n');
} finally {
  if (child && !child.killed) {
    const childExit = once(child, 'exit').catch(() => undefined);
    child.kill();
    // Windows can leave the child exit event unsettled after a signal. Gate B
    // must preserve its actual verification result instead of hanging in cleanup.
    await Promise.race([childExit, sleep(1_000)]);
  }
  if (database) {
    await database.onModuleDestroy();
  }
  await pool.end();
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function fixtureTenant(prefix) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  return { id: randomUUID(), code: `${prefix}-${suffix}`, name: `Baseer ERP ${prefix}` };
}

async function seedFixture() {
  const passwordHash = await bcrypt.hash(gatePassword, 12);
  await pool.query(
    'INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3), ($4::uuid, $5, $6)',
    [tenantA.id, tenantA.code, tenantA.name, tenantB.id, tenantB.code, tenantB.name],
  );
  await seedTenant({
    tenant: tenantA,
    userId: fixture.userA,
    companyId: fixture.companyA,
    roleId: fixture.roleA,
    passwordHash,
    login: 'gate.b.user@baseer.test',
    capabilities: ['foundation.verify', 'platform.business-date.read', 'platform.output.preview', 'platform.output.export', 'platform.files.read', 'platform.files.write', 'platform.observability.read', 'finance.setup.write', 'finance.configuration.read', 'finance.vaults.write', 'finance.periods.write', 'finance.supplier_dues.read', 'finance.supplier_dues.write', 'finance.loans.write'],
  });
  await seedTenant({
    tenant: tenantB,
    userId: fixture.userB,
    companyId: fixture.companyB,
    roleId: fixture.roleB,
    passwordHash,
    login: 'other.tenant@baseer.test',
    capabilities: ['foundation.verify'],
  });
}

async function seedTenant(input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [input.tenant.id]);
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash")
       VALUES ($1::uuid, $2::uuid, $3, 'Gate B User AR', 'Gate B Test User', $4)`,
      [input.userId, input.tenant.id, input.login, input.passwordHash],
    );
    await client.query(
      `INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn")
       VALUES ($1::uuid, $2::uuid, 'Gate B Company AR', 'Gate B Test Company')`,
      [input.companyId, input.tenant.id],
    );
    await client.query(
      `INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn", "isSystem")
       VALUES ($1::uuid, $2::uuid, 'gate-b-verifier', 'Gate B Verifier AR', 'Gate B Verifier', true)`,
      [input.roleId, input.tenant.id],
    );
    for (const capability of input.capabilities) {
      await client.query(
        'INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3)',
        [input.tenant.id, input.roleId, capability],
      );
    }
    await client.query(
      `INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
      [input.tenant.id, input.userId, input.companyId, input.roleId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyRlsIsolation() {
  const unscoped = await pool.query('SELECT count(*)::int AS count FROM "User"');
  assert.equal(unscoped.rows[0].count, 0, 'RLS must deny unscoped user reads.');

  assert.equal(await scopedUserCount(tenantA.id, fixture.userA), 1, 'Tenant A must read its own user.');
  assert.equal(await scopedUserCount(tenantB.id, fixture.userA), 0, 'Tenant B must not read Tenant A user.');
}

async function scopedUserCount(tenantId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query('SELECT count(*)::int AS count FROM "User" WHERE "id" = $1::uuid', [userId]);
    await client.query('COMMIT');
    return result.rows[0].count;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startApi() {
  return spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: process.cwd(),
    env: { ...process.env, BASEER_API_PORT: '5298' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

async function waitForApi() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status < 500) return;
    } catch {
      // The child process is still booting.
    }
    await sleep(200);
  }
  throw new Error('Baseer API did not become ready for Gate B verification.');
}

async function signIn() {
  const response = await request('/auth/sign-in', {
    headers: { 'x-baseer-tenant-code': tenantA.code },
    body: { login: 'Gate.B.User@Baseer.Test', password: gatePassword },
  });
  assert.equal(response.status, 200, 'Valid Baseer sign-in must succeed.');
  assert.equal(typeof response.body.accessToken, 'string');
  assert.equal(typeof response.body.refreshToken, 'string');
  return response.body;
}

async function verifySafeFailedSignIn() {
  const response = await request('/auth/sign-in', {
    headers: { 'x-baseer-tenant-code': tenantA.code },
    body: { login: 'gate.b.user@baseer.test', password: 'incorrect' },
  });
  assert.equal(response.status, 401, 'Invalid credentials must be rejected.');
  assert.equal(response.body.error?.code, 'AUTHENTICATION_FAILED');
  assert.equal(typeof response.body.error?.message?.ar, 'string');
  assert.equal(typeof response.body.error?.message?.en, 'string');
  assert.equal(typeof response.body.error?.correlationId, 'string');
  assert.equal('accessToken' in response.body, false, 'Safe failure receipts must not include tokens.');
}

async function verifyLiveCompanyAuthorization(accessToken) {
  const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
  const { IdentityTokenService } = await import('../apps/api/dist/identity/identity-token.service.js');
  const { CompanyContextService } = await import('../apps/api/dist/company-context/company-context.service.js');
  database = new DatabaseService();
  const context = new CompanyContextService(database, new IdentityTokenService());

  const authorized = await context.authorize({
    accessToken,
    companyId: fixture.companyA,
    requiredCapabilities: ['foundation.verify'],
  });
  assert.equal(authorized.principal.userId, fixture.userA);

  await assert.rejects(
    () => context.authorize({
      accessToken,
      companyId: fixture.companyA,
      requiredCapabilities: ['foundation.not-granted'],
    }),
    (error) => error?.getStatus?.() === 403,
    'Live capability lookup must reject a capability absent from the role.',
  );
}

async function verifyBusinessDate(accessToken) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'x-baseer-company-id': fixture.companyA,
  };
  const current = await request('/business-date/resolve', { headers, body: { intent: { kind: 'current' } } });
  assert.equal(current.status, 200, 'A permitted user must resolve the current business date.');
  assert.equal(current.body.timezone, 'Asia/Riyadh');
  assert.match(current.body.businessDate, /^\d{4}-\d{2}-\d{2}$/);

  const leapMonth = await request('/business-date/resolve', {
    headers,
    body: { intent: { kind: 'month', month: '2024-02' } },
  });
  assert.equal(leapMonth.status, 200);
  assert.deepEqual(leapMonth.body.range, { startDate: '2024-02-01', endDate: '2024-02-29' });

  const invalidDate = await request('/business-date/resolve', {
    headers,
    body: { intent: { kind: 'date', businessDate: '2026-02-29' } },
  });
  assert.equal(invalidDate.status, 400, 'An invalid Gregorian date must be rejected.');

  const reversedRange = await request('/business-date/resolve', {
    headers,
    body: { intent: { kind: 'range', startDate: '2026-08-16', endDate: '2026-08-15' } },
  });
  assert.equal(reversedRange.status, 409, 'A reversed business-date range must be rejected.');

  const crossCompany = await request('/business-date/resolve', {
    headers: { ...headers, 'x-baseer-company-id': fixture.companyB },
    body: { intent: { kind: 'current' } },
  });
  assert.equal(crossCompany.status, 403, 'A cross-company date resolution must be denied.');

  const { resolveBusinessDateIntent } = await import('../apps/api/dist/business-date/business-date.service.js');
  const beforeMidnight = resolveBusinessDateIntent({ kind: 'current' }, new Date('2026-08-14T20:59:59.000Z'));
  const afterMidnight = resolveBusinessDateIntent({ kind: 'current' }, new Date('2026-08-14T21:00:00.000Z'));
  assert.equal(beforeMidnight.businessDate, '2026-08-14');
  assert.equal(afterMidnight.businessDate, '2026-08-15');
}
async function verifyFinanceHttpBoundaries(accessToken) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'x-baseer-company-id': fixture.companyA,
  };
  const validPayload = {
    fiscalPeriodNameAr: 'السنة المالية 2026',
    fiscalPeriodNameEn: 'Financial year 2026',
    fiscalPeriodStartDate: '2026-01-01',
    fiscalPeriodEndDate: '2026-12-31',
    selectedVaults: ['CASH'],
    idempotencyKey: randomUUID(),
  };

  const unauthorized = await request('/finance/company-setup', { body: validPayload });
  assert.equal(unauthorized.status, 401, 'Finance setup must reject an anonymous request.');

  const invalidDate = await request('/finance/company-setup', {
    headers,
    body: { ...validPayload, fiscalPeriodStartDate: '2026-02-30', idempotencyKey: randomUUID() },
  });
  assert.equal(invalidDate.status, 400, 'Finance setup must reject an impossible Gregorian date.');

  const created = await request('/finance/company-setup', { headers, body: validPayload });
  assert.equal(created.status, 201, 'Authorized finance setup must initialize a company exactly once.');
  assert.match(created.body.periodId, /^[0-9a-f-]{36}$/i);
  assert.equal(created.body.vaultIds.length, 1);

  const replay = await request('/finance/company-setup', { headers, body: validPayload });
  assert.equal(replay.status, 201, 'An identical finance setup must safely replay.');
  assert.deepEqual(replay.body, created.body, 'Setup replay must return the original receipt.');

  const configuration = await getRequest('/finance/configuration', headers);
  assert.equal(configuration.status, 200, 'Authorized finance configuration must be readable.');
  assert.equal(configuration.body.companyId, fixture.companyA);
  const cashVaultId = created.body.vaultIds[0];
  const expenseCategory = configuration.body.categories.find((category) => category.kind === 'EXPENSE' && category.status === 'ACTIVE');
  assert.ok(expenseCategory, 'Foundation setup must provide an active expense category.');

  const customVaultPayload = {
    nameAr: `خزينة اختبار ${randomUUID().slice(0, 8)}`,
    nameEn: `Test vault ${randomUUID().slice(0, 8)}`,
    type: 'ELECTRONIC',
    isSalesChannel: false,
    isPaymentDestination: true,
    idempotencyKey: randomUUID(),
  };
  const customVault = await request('/finance/vaults', { headers, body: customVaultPayload });
  assert.equal(customVault.status, 201, 'An authorized custom vault must be created.');
  const customVaultReplay = await request('/finance/vaults', { headers, body: customVaultPayload });
  assert.equal(customVaultReplay.status, 201, 'An identical vault command must replay.');
  assert.deepEqual(customVaultReplay.body, customVault.body);
  const removedCustomVault = await request('/finance/vaults/remove-or-archive', {
    headers,
    body: { vaultId: customVault.body.vaultId, idempotencyKey: randomUUID() },
  });
  assert.equal(removedCustomVault.status, 201, 'A custom vault with no history must be removable.');
  assert.equal(removedCustomVault.body.result, 'deleted');

  const supplierId = randomUUID();
  await tenantQuery(tenantA.id,
    `INSERT INTO "FinanceSupplier" ("id", "tenantId", "companyId", "categoryId", "nameAr", "nameEn")
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Gate B Supplier', 'Gate B Supplier')`,
    [supplierId, tenantA.id, fixture.companyA, expenseCategory.id],
  );
  const due = await request('/finance/supplier-dues', {
    headers,
    body: {
      supplierId,
      categoryId: expenseCategory.id,
      sourceDocumentNumber: `GATE-DUE-${randomUUID().slice(0, 8)}`,
      businessDate: '2026-08-15',
      dueDate: '2026-08-20',
      amount: '500.0000',
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(due.status, 201, 'An authorized supplier due must post through the HTTP boundary.');
  const duePayment = await request('/finance/supplier-dues/payments', {
    headers,
    body: { dueId: due.body.dueId, vaultId: cashVaultId, businessDate: '2026-08-15', amount: '200.0000', idempotencyKey: randomUUID() },
  });
  assert.equal(duePayment.status, 201, 'A supplier-due partial payment must post through the HTTP boundary.');
  const paidProjection = await getRequest('/finance/supplier-dues/cash-payments', headers);
  assert.equal(paidProjection.status, 200);
  assert.equal(paidProjection.body.payments.some((payment) => payment.paymentId === duePayment.body.paymentId), true, 'Only posted payment must enter the cash projection.');
  const reversedDuePayment = await request('/finance/supplier-dues/payments/reverse', {
    headers,
    body: { paymentId: duePayment.body.paymentId, businessDate: '2026-08-16', reason: 'Gate B reversal', idempotencyKey: randomUUID() },
  });
  assert.equal(reversedDuePayment.status, 201, 'A supplier-due payment reversal must post through the HTTP boundary.');

  const openingLoan = await request('/finance/inclusive-loans', {
    headers,
    body: {
      sourceDocumentNumber: `GATE-LOAN-${randomUUID().slice(0, 8)}`,
      originalAmount: '1000.0000',
      openingOutstandingAmount: '500.0000',
      installmentAmount: '100.0000',
      termMonths: 5,
      firstInstallmentDueDate: '2026-09-01',
      openingBusinessDate: '2026-08-15',
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(openingLoan.status, 201, 'An inclusive opening loan must post through the HTTP boundary.');
  const loanPayment = await request('/finance/inclusive-loans/repayments', {
    headers,
    body: { loanId: openingLoan.body.loanId, vaultId: cashVaultId, businessDate: '2026-08-16', amount: '100.0000', idempotencyKey: randomUUID() },
  });
  assert.equal(loanPayment.status, 201, 'An inclusive-loan repayment must post through the HTTP boundary.');
  const reversedLoanPayment = await request('/finance/inclusive-loans/repayments/reverse', {
    headers,
    body: { paymentId: loanPayment.body.paymentId, businessDate: '2026-08-17', reason: 'Gate B reversal', idempotencyKey: randomUUID() },
  });
  assert.equal(reversedLoanPayment.status, 201, 'An inclusive-loan repayment reversal must post through the HTTP boundary.');

  const closePeriod = await request('/finance/periods/close', {
    headers,
    body: { periodId: created.body.periodId, reason: 'Gate B period lifecycle verification', idempotencyKey: randomUUID() },
  });
  assert.equal(closePeriod.status, 200, 'An authorized period close must succeed.');
  assert.equal(closePeriod.body.status, 'CLOSED');
  const reopenPeriod = await request('/finance/periods/reopen', {
    headers,
    body: { periodId: created.body.periodId, reason: 'Gate B period lifecycle verification', idempotencyKey: randomUUID() },
  });
  assert.equal(reopenPeriod.status, 200, 'An authorized closed period must reopen with a reason.');
  assert.equal(reopenPeriod.body.status, 'OPEN');
  const crossCompany = await request('/finance/company-setup', {
    headers: { ...headers, 'x-baseer-company-id': fixture.companyB },
    body: { ...validPayload, idempotencyKey: randomUUID() },
  });
  assert.equal(crossCompany.status, 403, 'Finance setup must deny cross-company access.');

  const projection = await getRequest('/finance/supplier-dues/cash-payments', headers);
  assert.equal(projection.status, 200, 'Authorized paid-only cash projection must be readable.');
  assert.equal(projection.body.companyId, fixture.companyA);
  assert.deepEqual(projection.body.payments, []);

  const history = await getRequest('/finance/supplier-dues', headers);
  assert.equal(history.status, 200, 'Authorized supplier-due history must be readable.');
  assert.equal(history.body.companyId, fixture.companyA);
  const historyDue = history.body.dues.find((item) => item.id === due.body.dueId);
  assert.ok(historyDue, 'Supplier-due history must contain the created due.');
  assert.equal(historyDue.status, 'OPEN');
  assert.equal(historyDue.paidAmount, '0.0000');
  assert.equal(historyDue.payments.every((payment) => payment.status === 'REVERSED'), true, 'History must retain reversal evidence.');

  const crossCompanyHistory = await getRequest('/finance/supplier-dues', { ...headers, 'x-baseer-company-id': fixture.companyB });
  assert.equal(crossCompanyHistory.status, 403, 'Supplier-due history must deny cross-company access.');

  const invalidProjectionDate = await getRequest('/finance/supplier-dues/cash-payments?fromBusinessDate=2026-02-30', headers);
  assert.equal(invalidProjectionDate.status, 400, 'Cash projection must reject impossible Gregorian dates.');
}
async function verifyOutputPlatform(accessToken) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'x-baseer-company-id': fixture.companyA,
  };
  const idempotencyKey = randomUUID();
  const previewPayload = { format: 'preview', locale: 'ar', filters: {}, idempotencyKey };
  const preview = await request('/outputs/platform.company-context', { headers, body: previewPayload });
  assert.equal(preview.status, 200, 'Authorized preview output must succeed.');
  assert.equal(preview.body.format, 'preview');
  assert.equal(preview.body.contentEncoding, 'utf8');
  assert.match(preview.body.content, /Gate B Company AR/);

  const replay = await request('/outputs/platform.company-context', { headers, body: previewPayload });
  assert.equal(replay.status, 200, 'An identical output request must replay.');
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.snapshotId, preview.body.snapshotId);

  const mismatch = await request('/outputs/platform.company-context', {
    headers,
    body: { ...previewPayload, locale: 'en' },
  });
  assert.equal(mismatch.status, 409, 'A changed output request must conflict on the same idempotency key.');
  assert.equal(mismatch.body.error?.code, 'CONFLICT');

  const crossCompany = await request('/outputs/platform.company-context', {
    headers: { ...headers, 'x-baseer-company-id': fixture.companyB },
    body: { format: 'preview', locale: 'ar', filters: {}, idempotencyKey: randomUUID() },
  });
  assert.equal(crossCompany.status, 403, 'A cross-company output request must be denied.');

  const xlsx = await request('/outputs/platform.company-context', {
    headers,
    body: { format: 'xlsx', locale: 'en', filters: {}, idempotencyKey: randomUUID() },
  });
  assert.equal(xlsx.status, 200, 'Authorized XLSX output must succeed.');
  assert.equal(xlsx.body.contentEncoding, 'base64');
  assert.ok(Buffer.from(xlsx.body.content, 'base64').length > 1_000);

  const printIssued = await fetch(`${baseUrl}/outputs/print-issued`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': randomUUID(), ...headers },
    body: JSON.stringify({ idempotencyReceiptId: preview.body.idempotencyReceiptId }),
  });
  assert.equal(printIssued.status, 204, 'A preview print-issued event must be auditable.');

  const outputEvents = await tenantQuery(tenantA.id,
    'SELECT "action" FROM "AuditEvent" WHERE "actorUserId" = $1::uuid AND "action" LIKE $2',
    [fixture.userA, 'output.%']);
  const actions = new Set(outputEvents.rows.map((row) => row.action));
  for (const action of ['output.requested', 'output.generated', 'output.preview_issued', 'output.download_issued', 'output.print_issued', 'output.replayed']) {
    assert.ok(actions.has(action), `Missing output audit action: ${action}`);
  }
}
async function verifyFileMetadata(accessToken) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'x-baseer-company-id': fixture.companyA,
  };
  const sourceId = randomUUID();
  const initialPayload = {
    sourceType: 'platform.company-context',
    sourceId,
    purpose: 'verification-proof',
    displayName: 'proof.pdf',
    declaredMimeType: 'application/pdf',
    declaredByteSize: 1024,
    declaredSha256: 'a'.repeat(64),
    idempotencyKey: randomUUID(),
  };
  const created = await request('/file-metadata', { headers, body: initialPayload });
  assert.equal(created.status, 201, 'A permitted user must reserve company-scoped file metadata.');
  assert.equal(created.body.status, 'RESERVED');
  assert.equal(created.body.version, 1);
  assert.equal('storageReference' in created.body, false, 'Storage references must never be returned to the UI.');
  assert.equal('path' in created.body, false, 'Filesystem paths must never be returned to the UI.');

  const replay = await request('/file-metadata', { headers, body: initialPayload });
  assert.equal(replay.status, 201, 'An identical file metadata request must replay.');
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.id, created.body.id);

  const mismatch = await request('/file-metadata', {
    headers,
    body: { ...initialPayload, displayName: 'changed.pdf' },
  });
  assert.equal(mismatch.status, 409, 'A changed file metadata request must conflict on the same idempotency key.');

  const duplicate = await request('/file-metadata', {
    headers,
    body: { ...initialPayload, idempotencyKey: randomUUID() },
  });
  assert.equal(duplicate.status, 409, 'An active source/purpose may not be silently overwritten.');

  const replacement = await request('/file-metadata', {
    headers,
    body: {
      ...initialPayload,
      displayName: 'proof-v2.pdf',
      declaredSha256: 'b'.repeat(64),
      idempotencyKey: randomUUID(),
      replacesFileMetadataId: created.body.id,
    },
  });
  assert.equal(replacement.status, 201, 'A replacement must reserve a new immutable version.');
  assert.equal(replacement.body.status, 'RESERVED');
  assert.equal(replacement.body.version, 2);
  assert.equal(replacement.body.replacesFileMetadataId, created.body.id);

  const original = await getRequest(`/file-metadata/${created.body.id}`, headers);
  assert.equal(original.status, 200);
  assert.equal(original.body.status, 'SUPERSEDED', 'A replaced record must remain readable as superseded evidence.');

  const current = await getRequest(`/file-metadata/${replacement.body.id}`, headers);
  assert.equal(current.status, 200);
  assert.equal(current.body.status, 'RESERVED');

  const crossCompany = await getRequest(`/file-metadata/${replacement.body.id}`, {
    ...headers,
    'x-baseer-company-id': fixture.companyB,
  });
  assert.equal(crossCompany.status, 403, 'Cross-company file metadata access must be denied.');

  const tenantBSession = await request('/auth/sign-in', {
    headers: { 'x-baseer-tenant-code': tenantB.code },
    body: { login: 'other.tenant@baseer.test', password: gatePassword },
  });
  assert.equal(tenantBSession.status, 200);
  const noCapability = await request('/file-metadata', {
    headers: {
      authorization: `Bearer ${tenantBSession.body.accessToken}`,
      'x-baseer-company-id': fixture.companyB,
    },
    body: { ...initialPayload, sourceId: randomUUID(), idempotencyKey: randomUUID() },
  });
  assert.equal(noCapability.status, 403, 'File metadata write requires its live company capability.');

  const unscoped = await pool.query('SELECT count(*)::int AS count FROM "FileMetadata"');
  assert.equal(unscoped.rows[0].count, 0, 'RLS must deny unscoped file metadata reads.');
  const scoped = await tenantQuery(tenantA.id, 'SELECT count(*)::int AS count FROM "FileMetadata" WHERE "id" = $1::uuid', [replacement.body.id]);
  assert.equal(scoped.rows[0].count, 1, 'Tenant A must read its own file metadata row.');

  const fileEvents = await tenantQuery(tenantA.id,
    'SELECT "action" FROM "AuditEvent" WHERE "actorUserId" = $1::uuid AND "action" LIKE $2',
    [fixture.userA, 'file_metadata.%']);
  const actions = new Set(fileEvents.rows.map((row) => row.action));
  for (const action of ['file_metadata.created', 'file_metadata.replayed', 'file_metadata.superseded']) {
    assert.ok(actions.has(action), `Missing file metadata audit action: ${action}`);
  }
  return replacement.body.id;
}

async function verifyFileMetadataRevocation(accessToken, fileMetadataId) {
  const response = await getRequest(`/file-metadata/${fileMetadataId}`, {
    authorization: `Bearer ${accessToken}`,
    'x-baseer-company-id': fixture.companyA,
  });
  assert.equal(response.status, 401, 'A revoked session must not read file metadata.');
}

async function verifyObservability(accessToken) {
  const correlationId = randomUUID();
  const health = await fetch(`${baseUrl}/health`, {
    headers: { 'x-request-id': correlationId },
  });
  assert.equal(health.status, 200, 'Liveness health must be public and successful.');
  assert.equal(health.headers.get('x-request-id'), correlationId, 'A valid request ID must be returned unchanged.');
  assert.deepEqual(await health.json(), { status: 'ok', service: 'baseer-erp-api' });

  const readiness = await fetch(`${baseUrl}/health/ready`, { headers: { 'x-request-id': randomUUID() } });
  assert.equal(readiness.status, 200, 'The disposable Baseer database must be ready.');
  assert.deepEqual(await readiness.json(), { status: 'ready', service: 'baseer-erp-api' });

  const invalidHeader = 'invalid request id with spaces';
  const invalidCorrelation = await fetch(`${baseUrl}/health`, { headers: { 'x-request-id': invalidHeader } });
  assert.equal(invalidCorrelation.status, 200);
  assert.match(invalidCorrelation.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/i, 'Unsafe request IDs must be replaced.');
  assert.notEqual(invalidCorrelation.headers.get('x-request-id'), invalidHeader);

  const auditedSignIn = await request('/auth/sign-in', {
    headers: { 'x-baseer-tenant-code': tenantA.code, 'x-request-id': correlationId },
    body: { login: 'gate.b.user@baseer.test', password: gatePassword },
  });
  assert.equal(auditedSignIn.status, 200);
  assert.equal(auditedSignIn.responseCorrelationId, correlationId);
  const audit = await tenantQuery(tenantA.id,
    'SELECT count(*)::int AS count FROM "AuditEvent" WHERE "requestId" = $1 AND "action" = $2',
    [correlationId, 'identity.sign_in']);
  assert.ok(audit.rows[0].count >= 1, 'The request correlation ID must reach transaction-bound audit.');

  const summary = await getRequest('/observability/summary', {
    authorization: `Bearer ${accessToken}`,
    'x-baseer-company-id': fixture.companyA,
  });
  assert.equal(summary.status, 200, 'A permitted user must read the bounded operational summary.');
  assert.equal(summary.body.readiness, 'ready');
  assert.ok(Array.isArray(summary.body.metrics));
  assert.ok(summary.body.metrics.length > 0 && summary.body.metrics.length <= 256);
  assert.equal(JSON.stringify(summary.body).includes(correlationId), false, 'Operational summary must not expose correlation IDs or request-specific values.');
  for (const metric of summary.body.metrics) {
    assert.match(metric.route, /^\//, 'Metrics must use route templates rather than raw request values.');
    assert.match(metric.statusClass, /^[2345]xx$/);
  }

  const crossCompany = await getRequest('/observability/summary', {
    authorization: `Bearer ${accessToken}`,
    'x-baseer-company-id': fixture.companyB,
  });
  assert.equal(crossCompany.status, 403, 'Cross-company diagnostics access must be denied.');

  const tenantBSession = await request('/auth/sign-in', {
    headers: { 'x-baseer-tenant-code': tenantB.code },
    body: { login: 'other.tenant@baseer.test', password: gatePassword },
  });
  assert.equal(tenantBSession.status, 200);
  const noCapability = await getRequest('/observability/summary', {
    authorization: `Bearer ${tenantBSession.body.accessToken}`,
    'x-baseer-company-id': fixture.companyB,
  });
  assert.equal(noCapability.status, 403, 'Operational summary requires its live company capability.');

  const safeFailure = await request('/auth/sign-in', {
    headers: { 'x-baseer-tenant-code': tenantA.code, 'x-request-id': correlationId },
    body: { login: 'gate.b.user@baseer.test', password: 'incorrect' },
  });
  assert.equal(safeFailure.status, 401);
  assert.equal(safeFailure.responseCorrelationId, correlationId);
  assert.equal(safeFailure.body.error?.correlationId, correlationId, 'Safe error receipt must share the request correlation ID.');
}

async function verifyObservabilityRevocation(accessToken) {
  const response = await getRequest('/observability/summary', {
    authorization: `Bearer ${accessToken}`,
    'x-baseer-company-id': fixture.companyA,
  });
  assert.equal(response.status, 401, 'A revoked session must not read operational diagnostics.');
}

async function verifyRefreshRotationAndReplay(firstRefreshToken) {
  const rotated = await request('/auth/refresh', { body: { refreshToken: firstRefreshToken } });
  assert.equal(rotated.status, 200, 'A current refresh token must rotate successfully.');

  const replay = await request('/auth/refresh', { body: { refreshToken: firstRefreshToken } });
  assert.equal(replay.status, 401, 'A replayed refresh token must be rejected.');

  const accessClaims = JSON.parse(Buffer.from(rotated.body.accessToken.split('.')[1], 'base64url').toString('utf8'));
  const sessionStatus = await tenantQuery(tenantA.id,
    'SELECT "status" FROM "AppSession" WHERE "id" = $1::uuid', [accessClaims.sessionId]);
  assert.equal(sessionStatus.rows[0].status, 'REVOKED', 'Refresh replay must revoke the active session.');
  return rotated.body.accessToken;
}

async function verifyOutputRevocation(accessToken) {
  const response = await request('/outputs/platform.company-context', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-baseer-company-id': fixture.companyA,
    },
    body: { format: 'preview', locale: 'ar', filters: {}, idempotencyKey: randomUUID() },
  });
  assert.equal(response.status, 401, 'A revoked output session must be rejected.');
}

async function verifySignOut() {
  const current = await signIn();
  const signOut = await fetch(`${baseUrl}/auth/sign-out`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${current.accessToken}`,
      'x-request-id': randomUUID(),
    },
  });
  assert.equal(signOut.status, 204, 'Sign-out must revoke an active session.');
}

async function verifyAuditRollback() {
  const before = await tenantQuery(tenantA.id,
    'SELECT count(*)::int AS count FROM "AuditEvent" WHERE "action" = $1', ['gate_b.rollback_probe']);
  await assert.rejects(
    () => database.inTenantTransaction(tenantA.id, async (transaction) => {
      await transaction.auditEvent.create({
        data: {
          tenantId: tenantA.id,
          actorUserId: fixture.userA,
          action: 'gate_b.rollback_probe',
          entityType: 'GateB',
          entityId: randomUUID(),
          requestId: randomUUID(),
        },
      });
      throw new Error('intentional Gate B rollback');
    }),
  );
  const after = await tenantQuery(tenantA.id,
    'SELECT count(*)::int AS count FROM "AuditEvent" WHERE "action" = $1', ['gate_b.rollback_probe']);
  assert.equal(after.rows[0].count, before.rows[0].count, 'Rolled-back business work must not retain its audit event.');
}

async function verifyIdempotency() {
  const { IdempotencyService, IdempotencyPayloadMismatchError } = await import('../apps/api/dist/core-controls/index.js');
  const service = new IdempotencyService(database);
  const context = { tenantId: tenantA.id, companyId: fixture.companyA, actorUserId: fixture.userA };
  const input = {
    operation: 'gate-b.verify',
    key: randomUUID(),
    request: { amount: 42, currency: 'SAR' },
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  const started = await service.begin(context, input);
  assert.equal(started.kind, 'started');
  const inProgress = await service.begin(context, input);
  assert.equal(inProgress.kind, 'in-progress');
  await service.complete(context, { receiptId: started.receiptId, response: { status: 201, headers: null, body: { ok: true } } });
  const replay = await service.begin(context, input);
  assert.equal(replay.kind, 'replay');
  assert.equal(replay.response.status, 201);
  await assert.rejects(
    () => service.begin(context, { ...input, request: { amount: 43, currency: 'SAR' } }),
    IdempotencyPayloadMismatchError,
  );
}

async function verifyConcurrentSerials() {
  const { DocumentSerialService } = await import('../apps/api/dist/core-controls/index.js');
  const service = new DocumentSerialService(database);
  const context = { tenantId: tenantA.id, companyId: fixture.companyA, actorUserId: fixture.userA };
  const reservations = await Promise.all(
    Array.from({ length: 20 }, () => service.reserve(context, { series: 'GATE-B', businessDate: '2026-08-15' })),
  );
  const ordered = reservations.map(Number).sort((left, right) => left - right);
  assert.deepEqual(ordered, Array.from({ length: 20 }, (_, index) => index + 1), 'Concurrent serial reservations must be gapless and unique.');
}

async function tenantQuery(tenantId, sql, values) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getRequest(path, headers = {}) {
  const correlationId = typeof headers['x-request-id'] === 'string' ? headers['x-request-id'] : randomUUID();
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: { 'x-request-id': correlationId, ...headers },
  });
  return { status: response.status, body: await response.json(), correlationId, responseCorrelationId: response.headers.get('x-request-id') };
}

async function request(path, { headers = {}, body }) {
  const correlationId = typeof headers['x-request-id'] === 'string' ? headers['x-request-id'] : randomUUID();
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': correlationId, ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), correlationId, responseCorrelationId: response.headers.get('x-request-id') };
}
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
