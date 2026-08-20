import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

const { Pool } = pg;
const pool = new Pool({
  connectionString: requiredEnvironment("DATABASE_URL"),
});
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const fixture = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  cashierUserId: randomUUID(),
  companyId: randomUUID(),
  tenantCode: `daily-http-${suffix}`,
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = fixture.tenantCode;
  const [
    { AppModule },
    { AuthService },
    { CompanyFinanceSetupService },
    { DatabaseService },
  ] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/finance/company-finance-setup.service.js"),
    import("../apps/api/dist/database/database.service.js"),
  ]);
  app = await NestFactory.create(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  app.setGlobalPrefix("v1");
  await app.init();
  const database = app.get(DatabaseService);
  const setup = app.get(CompanyFinanceSetupService);
  const context = {
    tenantId: fixture.tenantId,
    companyId: fixture.companyId,
    actorUserId: fixture.userId,
  };
  await setup.initialize(context, {
    fiscalPeriodNameAr: "ÙØªØ±Ø© HTTP",
    fiscalPeriodNameEn: "HTTP test period",
    fiscalPeriodStartDate: date("2026-01-01"),
    fiscalPeriodEndDate: date("2026-12-31"),
    selectedVaults: ["CASH", "BANK"],
  });
  const cashVault = await database.inTenantTransaction(
    fixture.tenantId,
    async (transaction) => {
      await transaction.companyFinanceProfile.update({
        where: { companyId: fixture.companyId },
        data: { vatAccountingEnabled: true, vatRateBasisPoints: 1500 },
      });
      return transaction.financeVault.findFirstOrThrow({
        where: {
          tenantId: fixture.tenantId,
          companyId: fixture.companyId,
          isSalesChannel: true,
          status: "ACTIVE",
        },
        select: { id: true },
      });
    },
  );
  const bankVault = await database.inTenantTransaction(fixture.tenantId, (transaction) => transaction.financeVault.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, type: "BANK", status: "ACTIVE" }, select: { id: true } }));
  const auth = app.get(AuthService);
  const session = await auth.signIn({
    login: `daily-http-${suffix}@baseer.test`,
    password: `Gate-${suffix}`,
    requestId: randomUUID(),
  });
  const cashierSession = await auth.signIn({
    login: `daily-cashier-${suffix}@baseer.test`,
    password: `Cashier-${suffix}`,
    requestId: randomUUID(),
  });
  const server = app.getHttpAdapter().getInstance();
  const body = {
    businessDate: "2026-08-15",
    scope: "ALL",
    customerCount: 2,
    allocations: [{ vaultId: cashVault.id, grossAmount: "115.0000" }],
    cashHandoverAmount: "75.0000",
    idempotencyKey: randomUUID(),
  };
  const unauthenticated = await server.inject({
    method: "POST",
    url: "/v1/finance/daily-sales/closings",
    payload: body,
  });
  assert.equal(
    unauthenticated.statusCode,
    401,
    "A daily sales write requires authentication.",
  );
  const headers = {
    authorization: `Bearer ${session.accessToken}`,
    "x-baseer-company-id": fixture.companyId,
  };
  const entryDate = await server.inject({
    method: "GET",
    url: "/v1/finance/daily-sales/entry-date",
    headers,
  });
  assert.equal(entryDate.statusCode, 200, entryDate.body);
  assert.equal(entryDate.json().timezone, "Asia/Riyadh", "Entry date must come from the server-owned Riyadh business date.");
  const { idempotencyKey: previewKey, ...previewPayload } = body;
  void previewKey;
  const preview = await server.inject({
    method: "POST",
    url: "/v1/finance/daily-sales/closings/preview",
    headers,
    payload: previewPayload,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.deepEqual(
    preview.json(),
    {
      grossAmount: "115.0000",
      netAmount: "100.0000",
      vatAmount: "15.0000",
      vatRateBasisPoints: 1500,
    },
    "The entry total preview must be calculated by the server.",
  );
  const created = await server.inject({
    method: "POST",
    url: "/v1/finance/daily-sales/closings",
    headers,
    payload: body,
  });
  assert.equal(created.statusCode, 201, created.body);
  const closing = created.json();
  assert.equal(closing.netAmount, "100.0000");
  assert.equal(closing.vatAmount, "15.0000");
  const financialRegister = await server.inject({
    method: "GET",
    url: "/v1/finance/invoice-register?fromBusinessDate=2026-08-15&toBusinessDate=2026-08-15&pageSize=1",
    headers,
  });
  assert.equal(financialRegister.statusCode, 200, financialRegister.body);
  assert.equal(financialRegister.json().summary.salesCount, 1, "The financial register summary must be calculated from the full server filter scope.");
  assert.equal(financialRegister.json().summary.grossAmount, undefined, "A mixed financial register must never expose a cross-source monetary total.");
  assert.equal(financialRegister.json().records.length, 1, "The financial register must return the requested bounded page size.");
  assert.equal(financialRegister.json().records[0].debitTotal, "115.0000", "Each register row must disclose its journal debit total.");
  assert.equal(financialRegister.json().records[0].creditTotal, "115.0000", "Each register row must disclose its journal credit total.");
  assert.equal(financialRegister.json().hasMore, false, "A complete one-record register scope must not advertise a next page.");
  const creditCategory = await server.inject({ method: "POST", url: "/v1/finance/master-data/categories", headers, payload: { code: `HTTP-CREDIT-${suffix}`, nameAr: "مصروف اختبار آجل", nameEn: "HTTP credit expense", kind: "EXPENSE", isPosting: true, idempotencyKey: randomUUID() } });
  assert.equal(creditCategory.statusCode, 201, creditCategory.body);
  const creditSupplier = await server.inject({ method: "POST", url: "/v1/finance/master-data/suppliers", headers, payload: { nameAr: "مورد اختبار آجل", nameEn: "HTTP credit supplier", isTaxRegistered: false, supplierType: "EXPENSE", categoryId: creditCategory.json().id, idempotencyKey: randomUUID() } });
  assert.equal(creditSupplier.statusCode, 201, creditSupplier.body);
  const payable = await server.inject({
    method: "POST",
    url: "/v1/finance/purchase-expense-documents",
    headers,
    payload: { kind: "EXPENSE", settlementKind: "PAYABLE", categoryId: creditCategory.json().id, supplierId: creditSupplier.json().id, supplierInvoiceMissingReason: "Scale verification fixture", businessDate: "2026-08-14", grossAmount: "100.0000", isTaxable: false, allocations: [], idempotencyKey: randomUUID() },
  });
  assert.equal(payable.statusCode, 201, payable.body);
  const secondPayable = await server.inject({
    method: "POST",
    url: "/v1/finance/purchase-expense-documents",
    headers,
    payload: { kind: "EXPENSE", settlementKind: "PAYABLE", categoryId: creditCategory.json().id, supplierId: creditSupplier.json().id, supplierInvoiceMissingReason: "Scale verification fixture", businessDate: "2026-08-13", grossAmount: "80.0000", isTaxable: false, allocations: [], idempotencyKey: randomUUID() },
  });
  assert.equal(secondPayable.statusCode, 201, secondPayable.body);
  const creditWorkspace = await server.inject({ method: "GET", url: "/v1/finance/purchase-expense-documents/credit-workspace?pageSize=1", headers });
  assert.equal(creditWorkspace.statusCode, 200, creditWorkspace.body);
  assert.equal(creditWorkspace.json().openInvoiceCount, 2, "The credit summary must cover every open due, independently of the page size.");
  assert.equal(creditWorkspace.json().suppliers.flatMap((supplier) => supplier.dues).length, 1, "The credit detail page must be bounded by the requested page size.");
  assert.equal(creditWorkspace.json().hasMore, true, "A bounded first credit page must advertise the next page.");
  assert.ok(creditWorkspace.json().nextCursor, "A bounded first credit page must return an opaque cursor.");
  const creditWorkspaceNext = await server.inject({ method: "GET", url: `/v1/finance/purchase-expense-documents/credit-workspace?pageSize=1&cursor=${creditWorkspace.json().nextCursor}`, headers });
  assert.equal(creditWorkspaceNext.statusCode, 200, creditWorkspaceNext.body);
  assert.equal(creditWorkspaceNext.json().suppliers.flatMap((supplier) => supplier.dues).length, 1, "The following credit page must preserve its bounded page size.");
  assert.equal(creditWorkspaceNext.json().hasMore, false, "The final credit page must not advertise another cursor.");
  const futureClosing = await server.inject({
    method: "POST",
    url: "/v1/finance/daily-sales/closings",
    headers,
    payload: { ...body, businessDate: "2099-01-01", idempotencyKey: randomUUID() },
  });
  assert.equal(futureClosing.statusCode, 400, "A future daily-sales date must be denied by the server.");
  const replay = await server.inject({
    method: "POST",
    url: "/v1/finance/daily-sales/closings",
    headers,
    payload: body,
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(
    replay.json().closingId,
    closing.closingId,
    "HTTP idempotency must replay the same response.",
  );
  const cashHandoverReport = await server.inject({
    method: "GET",
    url: "/v1/finance/daily-sales/cash-handovers?fromBusinessDate=2026-08-15&toBusinessDate=2026-08-15",
    headers,
  });
  assert.equal(cashHandoverReport.statusCode, 200, cashHandoverReport.body);
  assert.equal(cashHandoverReport.json().totalCashHandoverAmount, "75.0000");
  assert.equal(cashHandoverReport.json().recordCount, 1, "Only posted explicit handovers enter the cumulative report.");
  const shiftSummary = await server.inject({
    method: "GET",
    url: "/v1/finance/daily-sales/shift-summary?fromBusinessDate=2026-08-15&toBusinessDate=2026-08-15",
    headers,
  });
  assert.equal(shiftSummary.statusCode, 200, shiftSummary.body);
  assert.equal(shiftSummary.json().shifts.find((item) => item.scope === "ALL").grossAmount, "115.0000");
  const journalCountBeforeDayOff = await database.inTenantTransaction(
    fixture.tenantId,
    (transaction) =>
      transaction.financeJournalEntry.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      }),
  );
  const dayOff = await server.inject({
    method: "POST",
    url: "/v1/finance/operational-calendar/days",
    headers,
    payload: {
      businessDate: "2026-08-16",
      status: "CLOSED",
      source: "HOLIDAY",
      note: "DAY_OFF: HOLIDAY",
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(dayOff.statusCode, 200, dayOff.body);
  assert.equal(dayOff.json().status, "CLOSED");
  const journalCountAfterDayOff = await database.inTenantTransaction(
    fixture.tenantId,
    (transaction) =>
      transaction.financeJournalEntry.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      }),
  );
  assert.equal(
    journalCountAfterDayOff,
    journalCountBeforeDayOff,
    "A documented Day Off must not create a journal.",
  );
  const calendar = await server.inject({
    method: "GET",
    url: "/v1/finance/operational-calendar?fromBusinessDate=2026-08-15&toBusinessDate=2026-08-16",
    headers,
  });
  assert.equal(calendar.statusCode, 200, calendar.body);
  assert.deepEqual(
    calendar.json().days.map((day) => day.dataStatus),
    ["RECORDED", "CLOSED"],
  );
  const channelVaults = await server.inject({
    method: "GET",
    url: "/v1/finance/daily-sales/channel-vaults",
    headers,
  });
  assert.equal(channelVaults.statusCode, 200, channelVaults.body);
  assert.equal(
    channelVaults.json().vaults.length,
    1,
    "Daily-sales read scope returns only active sales channels.",
  );
  const workspace = await server.inject({
    method: "GET",
    url: "/v1/finance/daily-sales/workspace?fromBusinessDate=2026-08-15&toBusinessDate=2026-08-15",
    headers,
  });
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert.equal(workspace.json().closings[0].documentNumber, closing.documentNumber);
  assert.equal(workspace.json().cashHandovers.totalCashHandoverAmount, "75.0000");
  assert.equal(workspace.json().shifts.find((item) => item.scope === "ALL").grossAmount, "115.0000");
  assert.equal(workspace.json().vaults.length, 1);
  assert.ok(workspace.json().permissionCodes.includes("finance.daily_sales.read"));
  const expensesWorkspace = await server.inject({
    method: "GET",
    url: "/v1/finance/expenses-obligations-workspace",
    headers,
  });
  assert.equal(expensesWorkspace.statusCode, 200, expensesWorkspace.body);
  assert.equal(expensesWorkspace.json().companyId, fixture.companyId);
  assert.match(expensesWorkspace.json().businessDate, /^\d{4}-\d{2}-\d{2}$/, "Expenses workspace business date must be server-owned.");
  assert.equal(expensesWorkspace.json().configuration.companyId, fixture.companyId);
  const cashierExpensesWorkspace = await server.inject({
    method: "GET",
    url: "/v1/finance/expenses-obligations-workspace",
    headers: {
      authorization: `Bearer ${cashierSession.accessToken}`,
      "x-baseer-company-id": fixture.companyId,
    },
  });
  assert.equal(cashierExpensesWorkspace.statusCode, 403, "A cashier must not read expenses and obligations without its read capabilities.");
  const closingHistory = await server.inject({
    method: "GET",
    url: "/v1/finance/daily-sales/closings?fromBusinessDate=2026-08-15&toBusinessDate=2026-08-15",
    headers,
  });
  assert.equal(closingHistory.statusCode, 200, closingHistory.body);
  assert.equal(closingHistory.json().historyLimit, 50, "Supervisor history uses the bounded default page size.");
  assert.equal(closingHistory.json().hasMore, false, "A complete one-record history must not advertise a next page.");
  assert.equal(
    closingHistory.json().closings[0].documentNumber,
    closing.documentNumber,
    "History must be server-owned and company-scoped.",
  );
  const cashierHistory = await server.inject({
    method: "GET",
    url: "/v1/finance/daily-sales/closings?fromBusinessDate=2026-08-15&toBusinessDate=2026-08-15",
    headers: {
      authorization: `Bearer ${cashierSession.accessToken}`,
      "x-baseer-company-id": fixture.companyId,
    },
  });
  assert.equal(cashierHistory.statusCode, 200, cashierHistory.body);
  assert.equal(cashierHistory.json().historyLimit, 7, "Cashiers must be limited by the server.");
  assert.equal(cashierHistory.json().closings.length, 1, "Cashier history remains company-scoped.");
  const cashierHeaders = {
    authorization: `Bearer ${cashierSession.accessToken}`,
    "x-baseer-company-id": fixture.companyId,
  };
  const treasuryRead = await server.inject({ method: "GET", url: "/v1/finance/treasury", headers });
  assert.equal(treasuryRead.statusCode, 200, treasuryRead.body);
  const transferKey = randomUUID();
  const treasuryTransfer = await server.inject({ method: "POST", url: "/v1/finance/treasury/transfers", headers, payload: { fromVaultId: cashVault.id, toVaultId: bankVault.id, amount: "10.0000", businessDate: "2026-08-15", idempotencyKey: transferKey } });
  assert.equal(treasuryTransfer.statusCode, 201, treasuryTransfer.body);
  const treasuryReplay = await server.inject({ method: "POST", url: "/v1/finance/treasury/transfers", headers, payload: { fromVaultId: cashVault.id, toVaultId: bankVault.id, amount: "10.0000", businessDate: "2026-08-15", idempotencyKey: transferKey } });
  assert.equal(treasuryReplay.statusCode, 201, treasuryReplay.body);
  assert.equal(treasuryReplay.json().journalEntryId, treasuryTransfer.json().journalEntryId, "Treasury HTTP transfer must replay idempotently.");
  const vaultActivity = await server.inject({ method: "GET", url: `/v1/finance/treasury/${bankVault.id}/activity?toBusinessDate=2026-08-15&pageSize=1`, headers });
  assert.equal(vaultActivity.statusCode, 200, vaultActivity.body);
  assert.equal(vaultActivity.json().items[0].journalEntryId, treasuryTransfer.json().journalEntryId, "Vault activity must return the company's posted transfer movement.");
  assert.equal(vaultActivity.json().summary.inflow, "10.0000", "Vault activity totals must be server-owned.");
  const treasuryMismatch = await server.inject({ method: "POST", url: "/v1/finance/treasury/transfers", headers, payload: { fromVaultId: cashVault.id, toVaultId: bankVault.id, amount: "26.0000", businessDate: "2026-08-15", idempotencyKey: transferKey } });
  assert.equal(treasuryMismatch.statusCode, 409, "Treasury transfer must reject a reused idempotency key with different data.");
  const futureTreasuryTransfer = await server.inject({ method: "POST", url: "/v1/finance/treasury/transfers", headers, payload: { fromVaultId: cashVault.id, toVaultId: bankVault.id, amount: "10.0000", businessDate: "2099-01-01", idempotencyKey: randomUUID() } });
  assert.equal(futureTreasuryTransfer.statusCode, 400, "Future treasury transfer must be denied.");
  const cashierTreasury = await server.inject({ method: "GET", url: "/v1/finance/treasury", headers: cashierHeaders });
  assert.equal(cashierTreasury.statusCode, 403, "Cashiers must not read Treasury.");
  const cashierCreate = await server.inject({
    method: "POST",
    url: "/v1/finance/daily-sales/closings",
    headers: cashierHeaders,
    payload: {
      ...body,
      businessDate: "2026-08-14",
      cashHandoverAmount: undefined,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(cashierCreate.statusCode, 201, cashierCreate.body);
  const cashierCorrect = await server.inject({
    method: "POST",
    url: "/v1/finance/daily-sales/closings/correct",
    headers: cashierHeaders,
    payload: {
      closingId: cashierCreate.json().closingId,
      customerCount: 3,
      allocations: [{ vaultId: cashVault.id, grossAmount: "115.0000" }],
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(cashierCorrect.statusCode, 403, "Cashiers must not correct closings.");
  const cashierReverse = await server.inject({
    method: "POST",
    url: "/v1/finance/daily-sales/closings/reverse",
    headers: cashierHeaders,
    payload: {
      closingId: cashierCreate.json().closingId,
      businessDate: "2026-08-15",
      reason: "Must be denied",
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(cashierReverse.statusCode, 403, "Cashiers must not reverse closings.");
  const cashierDayOff = await server.inject({
    method: "POST",
    url: "/v1/finance/operational-calendar/days",
    headers: cashierHeaders,
    payload: {
      businessDate: "2026-08-13",
      status: "CLOSED",
      source: "HOLIDAY",
      note: "Must be denied",
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(cashierDayOff.statusCode, 403, "Cashiers must not mark a Day Off.");
  const foreign = await server.inject({
    method: "GET",
    url: "/v1/finance/operational-calendar?fromBusinessDate=2026-08-15&toBusinessDate=2026-08-15",
    headers: { ...headers, "x-baseer-company-id": randomUUID() },
  });
  assert.equal(
    foreign.statusCode,
    403,
    "A foreign company identifier must be denied.",
  );
  console.log(
    "Daily Sales HTTP verification passed: authentication, company capability scope, cashier server history limit, idempotent create, VAT receipt, server-owned preview, shift summary, cumulative cash handovers, documented Day Off without journal creation, calendar, channel vaults, company-authorized bounded sales and expenses workspaces, and closing history.",
  );
} finally {
  if (app) await app.close();
  await pool.end();
}

async function seedFixture() {
  const tenantCode = fixture.tenantCode;
  await pool.query(
    'INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)',
    [fixture.tenantId, tenantCode, `Daily HTTP ${suffix}`],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      fixture.tenantId,
    ]);
    const roleId = randomUUID();
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, 'Ù…Ø³ØªØ®Ø¯Ù… HTTP', 'HTTP user', $4)`,
      [
        fixture.userId,
        fixture.tenantId,
        `${tenantCode}@baseer.test`,
        await bcrypt.hash(`Gate-${suffix}`, 12),
      ],
    );
    const cashierRoleId = randomUUID();
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, 'ÙƒØ§Ø´ÙŠØ± HTTP', 'HTTP cashier', $4)`,
      [
        fixture.cashierUserId,
        fixture.tenantId,
        `daily-cashier-${suffix}@baseer.test`,
        await bcrypt.hash(`Cashier-${suffix}`, 12),
      ],
    );
    await client.query(
      'INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)',
      [fixture.companyId, fixture.tenantId, "Ø´Ø±ÙƒØ© HTTP", "HTTP company"],
    );
    await client.query(
      'INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)',
      [
        roleId,
        fixture.tenantId,
        `DAILY_HTTP_${suffix}`,
        "Ø¯ÙˆØ± HTTP",
        "HTTP role",
      ],
    );
    await client.query(
      'INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3), ($1::uuid, $2::uuid, $4), ($1::uuid, $2::uuid, $5)',
      [
        fixture.tenantId,
        roleId,
        "finance.daily_sales.read",
        "finance.daily_sales.write",
        "finance.daily_sales.history.read_all",
      ],
    );
    await client.query(
      'INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3), ($1::uuid, $2::uuid, $4), ($1::uuid, $2::uuid, $5)',
      [fixture.tenantId, roleId, "finance.configuration.read", "finance.loans.read", "finance.purchase_expense.read"],
    );
    await client.query(
      'INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3), ($1::uuid, $2::uuid, $4), ($1::uuid, $2::uuid, $5)',
      [fixture.tenantId, roleId, "finance.purchase_expense.create", "finance.categories.write", "finance.suppliers.write"],
    );
    await client.query(
      'INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3), ($1::uuid, $2::uuid, $4)',
      [fixture.tenantId, roleId, "finance.vaults.read", "finance.vaults.transfer"],
    );
    await client.query(
      'INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5)',
      [cashierRoleId, fixture.tenantId, `CASHIER_${suffix}`, "ÙƒØ§Ø´ÙŠØ±", "Cashier"],
    );
    await client.query(
      'INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3), ($1::uuid, $2::uuid, $4)',
      [fixture.tenantId, cashierRoleId, "finance.daily_sales.read", "finance.daily_sales.create"],
    );
    await client.query(
      'INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)',
      [fixture.tenantId, fixture.userId, fixture.companyId, roleId],
    );
    await client.query(
      'INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)',
      [fixture.tenantId, fixture.cashierUserId, fixture.companyId, cashierRoleId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}
function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
