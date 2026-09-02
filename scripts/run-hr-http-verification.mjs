import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment("DATABASE_URL") });
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const fixture = {
  tenantId: randomUUID(),
  companyId: randomUUID(),
  foreignCompanyId: randomUUID(),
  managerUserId: randomUUID(),
  readerUserId: randomUUID(),
  activeEmployeeId: randomUUID(),
  terminatedEmployeeId: randomUUID(),
  payrollRunId: randomUUID(),
  approvedPayrollRunId: randomUUID(),
  deductionId: randomUUID(),
  tenantCode: `hr-http-${suffix}`,
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = fixture.tenantCode;
  const [{ AppModule }, { AuthService }, { ApiExceptionFilter }, { BUSINESS_DATE_CLOCK }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/identity/auth.service.js"),
    import("../apps/api/dist/common/api-exception.filter.js"),
    import("../apps/api/dist/business-date/business-date.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  app.get(BUSINESS_DATE_CLOCK).now = () => new Date("2026-08-20T12:00:00.000Z");
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  const auth = app.get(AuthService);
  const managerSession = await auth.signIn({
    login: `hr-manager-${suffix}@baseer.test`,
    password: `Manager-${suffix}`,
    requestId: randomUUID(),
  });
  const readerSession = await auth.signIn({
    login: `hr-reader-${suffix}@baseer.test`,
    password: `Reader-${suffix}`,
    requestId: randomUUID(),
  });
  const server = app.getHttpAdapter().getInstance();
  const managerHeaders = {
    authorization: `Bearer ${managerSession.accessToken}`,
    "x-baseer-company-id": fixture.companyId,
  };
  const readerHeaders = {
    authorization: `Bearer ${readerSession.accessToken}`,
    "x-baseer-company-id": fixture.companyId,
  };

  await expectError(
    server.inject({ method: "GET", url: "/v1/hr/employees" }),
    401,
    "AUTHENTICATION_FAILED",
    "The HR register must require authentication.",
  );
  await expectError(
    server.inject({ method: "GET", url: "/v1/hr/employees", headers: { authorization: managerHeaders.authorization } }),
    403,
    "AUTHORIZATION_DENIED",
    "A missing company context must be denied.",
  );
  await expectError(
    server.inject({ method: "GET", url: "/v1/hr/employees", headers: { ...managerHeaders, "x-baseer-company-id": fixture.foreignCompanyId } }),
    403,
    "AUTHORIZATION_DENIED",
    "A company without membership must be denied.",
  );

  const managerRegister = await server.inject({ method: "GET", url: "/v1/hr/employees?pageSize=10", headers: managerHeaders });
  assert.equal(managerRegister.statusCode, 200, managerRegister.body);
  assert.equal(
    managerRegister.json().employees.find((employee) => employee.id === fixture.activeEmployeeId)?.currentMonthlyGross,
    "7000.0000",
    "A payroll reader may receive current compensation in the HR register.",
  );
  const readerRegister = await server.inject({ method: "GET", url: "/v1/hr/employees?pageSize=10", headers: readerHeaders });
  assert.equal(readerRegister.statusCode, 200, readerRegister.body);
  assert.equal(
    readerRegister.json().employees.find((employee) => employee.id === fixture.activeEmployeeId)?.currentMonthlyGross,
    null,
    "hr.employees.read alone must not disclose compensation.",
  );
  const readerDetail = await server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}`, headers: readerHeaders });
  assert.equal(readerDetail.statusCode, 200, readerDetail.body);
  assert.equal(readerDetail.json().employee.currentMonthlyGross, null);
  assert.equal(readerDetail.json().compensation, null);
  assert.deepEqual(readerDetail.json().compensationHistory, []);

  const managerDetail = await server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}`, headers: managerHeaders });
  assert.equal(managerDetail.statusCode, 200, managerDetail.body);
  assert.equal(managerDetail.json().services.length, 500, "The employee detail projection must remain bounded.");
  assert.equal(managerDetail.json().serviceCount, 501, "Employee detail must expose the exact service count beyond its bounded projection.");
  assert.equal(managerDetail.json().servicesHasMore, true, "Employee detail must disclose that more services are available from the paginated service register.");

  const compensationHistoryPage = await server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}/compensation-history?pageSize=1`, headers: managerHeaders });
  assert.equal(compensationHistoryPage.statusCode, 200, compensationHistoryPage.body);
  assert.equal(compensationHistoryPage.json().compensationHistory.length, 1);
  assert.equal(compensationHistoryPage.json().hasMore, true);
  assert.ok(compensationHistoryPage.json().nextCursor);
  const compensationHistoryNext = await server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}/compensation-history?pageSize=1&cursor=${compensationHistoryPage.json().nextCursor}`, headers: managerHeaders });
  assert.equal(compensationHistoryNext.statusCode, 200, compensationHistoryNext.body);
  assert.equal(compensationHistoryNext.json().compensationHistory.length, 1);
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.terminatedEmployeeId}/compensation-history?pageSize=1&cursor=${compensationHistoryPage.json().nextCursor}`, headers: managerHeaders }),
    400,
    "VALIDATION_FAILED",
    "A compensation-history cursor must remain bound to its employee and company scope.",
  );
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}/compensation-history?pageSize=1`, headers: readerHeaders }),
    403,
    "AUTHORIZATION_DENIED",
    "Compensation history must require payroll-read capability.",
  );

  const readerOverview = await server.inject({ method: "GET", url: "/v1/hr/overview", headers: readerHeaders });
  assert.equal(readerOverview.statusCode, 200, readerOverview.body);
  assert.equal(readerOverview.json().companyId, fixture.companyId);
  assert.ok(readerOverview.json().workforce);
  assert.ok(readerOverview.json().services);
  assert.equal(readerOverview.json().payroll, null, "Overview must not disclose payroll without hr.payroll.read.");
  assert.equal(readerOverview.json().financial, null);
  assert.equal(readerOverview.json().finalSettlements, null);

  const employeeJobSearch = await server.inject({ method: "GET", url: "/v1/hr/employees?search=HTTP%20Analyst&pageSize=1", headers: managerHeaders });
  assert.equal(employeeJobSearch.statusCode, 200, employeeJobSearch.body);
  assert.deepEqual(employeeJobSearch.json().employees.map((employee) => employee.id), [fixture.activeEmployeeId], "Employee search must include job title.");

  const payrollPage = await server.inject({ method: "GET", url: "/v1/hr/payroll-runs?pageSize=1", headers: managerHeaders });
  assert.equal(payrollPage.statusCode, 200, payrollPage.body);
  assert.equal(payrollPage.json().payrollRuns.length, 1);
  assert.equal(payrollPage.json().hasMore, true);
  assert.deepEqual(payrollPage.json().summary, { count: 2, cancelledCount: 1, grossAmount: "3000.0000", advanceSettlementAmount: "300.0000", administrativeDeductionAmount: "150.0000", netPayableAmount: "2550.0000" }, "Payroll summary must cover the full active filtered scope and disclose cancelled runs separately.");
  const payrollSearch = await server.inject({ method: "GET", url: "/v1/hr/payroll-runs?search=TARGET&pageSize=1", headers: managerHeaders });
  assert.equal(payrollSearch.statusCode, 200, payrollSearch.body);
  assert.equal(payrollSearch.json().summary.count, 1);
  assert.equal(payrollSearch.json().summary.netPayableAmount, "850.0000");
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/payroll-runs?search=TARGET&pageSize=1&cursor=${payrollPage.json().nextCursor}`, headers: managerHeaders }),
    400,
    "VALIDATION_FAILED",
    "A payroll cursor must remain bound to its original search scope.",
  );

  const leavePage = await server.inject({ method: "GET", url: "/v1/hr/leaves?pageSize=1", headers: managerHeaders });
  assert.equal(leavePage.statusCode, 200, leavePage.body);
  assert.equal(leavePage.json().leaves.length, 1);
  assert.deepEqual(leavePage.json().summary, { count: 3, onLeaveNow: 1, upcoming: 1, returned: 1 }, "Leave KPIs must use the company business date and full filter scope.");
  const leaveSearch = await server.inject({ method: "GET", url: "/v1/hr/leaves?search=EMP-HTTP-001&pageSize=1", headers: managerHeaders });
  assert.equal(leaveSearch.statusCode, 200, leaveSearch.body);
  assert.deepEqual(leaveSearch.json().summary, { count: 2, onLeaveNow: 1, upcoming: 1, returned: 0 });

  const servicePage = await server.inject({ method: "GET", url: "/v1/hr/services?pageSize=1", headers: managerHeaders });
  assert.equal(servicePage.statusCode, 200, servicePage.body);
  assert.equal(servicePage.json().services.length, 1);
  assert.deepEqual(servicePage.json().summary, { count: 501, expired: 1, due30: 1, due90: 1 }, "Service expiry KPIs must cover the full filtered scope.");
  const serviceSearch = await server.inject({ method: "GET", url: "/v1/hr/services?search=SVC-TARGET&pageSize=1", headers: managerHeaders });
  assert.equal(serviceSearch.statusCode, 200, serviceSearch.body);
  assert.deepEqual(serviceSearch.json().summary, { count: 1, expired: 0, due30: 0, due90: 1 });

  const deductionSearch = await server.inject({ method: "GET", url: "/v1/hr/deductions?search=TARGET-DEDUCTION&pageSize=1", headers: managerHeaders });
  assert.equal(deductionSearch.statusCode, 200, deductionSearch.body);
  assert.equal(deductionSearch.json().deductions.length, 1, "Deduction search must execute against the server register.");
  const payrollCollectionPreview = await server.inject({
    method: "POST",
    url: "/v1/hr/payroll-runs/preview",
    headers: managerHeaders,
    payload: { payrollMonth: "2026-08-01", businessDate: "2026-08-20", includeOnLeaveEmployeeIds: [], lines: [], pageSize: 1 },
  });
  assert.equal(payrollCollectionPreview.statusCode, 200, payrollCollectionPreview.body);
  const activePayrollPreview = payrollCollectionPreview.json().employees.find((employee) => employee.id === fixture.activeEmployeeId);
  assert.equal(activePayrollPreview.administrativeDeductions.length, 100);
  assert.equal(activePayrollPreview.administrativeDeductionCount, 102);
  assert.equal(activePayrollPreview.hasMoreAdministrativeDeductions, true, "Payroll preview must disclose truncated administrative deductions.");
  assert.equal(activePayrollPreview.advanceCount, 0);
  assert.equal(activePayrollPreview.hasMoreAdvances, false);
  const updatePayrollDraftPayload = {
    payrollRunId: fixture.payrollRunId,
    payrollMonth: "2026-08-01",
    businessDate: "2026-08-20",
    notes: "Updated through HTTP verification",
    includeAllEligible: true,
    includeOnLeaveEmployeeIds: [],
    lines: [{ employeeId: fixture.activeEmployeeId, advances: [], administrativeDeductions: [{ id: fixture.deductionId, amount: "5.0000" }] }],
    idempotencyKey: randomUUID(),
  };
  const payrollDraftUpdate = await server.inject({ method: "POST", url: "/v1/hr/payroll-runs/update", headers: managerHeaders, payload: updatePayrollDraftPayload });
  assert.equal(payrollDraftUpdate.statusCode, 200, payrollDraftUpdate.body);
  assert.equal(payrollDraftUpdate.json().id, fixture.payrollRunId);
  assert.equal(payrollDraftUpdate.json().replayed, false);
  const payrollDraftReplay = await server.inject({ method: "POST", url: "/v1/hr/payroll-runs/update", headers: managerHeaders, payload: updatePayrollDraftPayload });
  assert.equal(payrollDraftReplay.statusCode, 200, payrollDraftReplay.body);
  assert.equal(payrollDraftReplay.json().replayed, true, "Payroll-draft HTTP replay must be explicit.");
  const updatedPayrollDetail = await server.inject({ method: "GET", url: `/v1/hr/payroll-runs/${fixture.payrollRunId}`, headers: managerHeaders });
  assert.equal(updatedPayrollDetail.statusCode, 200, updatedPayrollDetail.body);
  assert.equal(updatedPayrollDetail.json().payrollRun.notes, "Updated through HTTP verification");
  assert.equal(updatedPayrollDetail.json().lines[0].administrativeDeductions[0].sourceId, fixture.deductionId);
  await expectError(
    server.inject({ method: "POST", url: "/v1/hr/payroll-runs/update", headers: readerHeaders, payload: { ...updatePayrollDraftPayload, idempotencyKey: randomUUID() } }),
    403,
    "AUTHORIZATION_DENIED",
    "Payroll-draft updates must require payroll-create capability.",
  );
  await expectError(
    server.inject({ method: "POST", url: "/v1/hr/payroll-runs/update", headers: managerHeaders, payload: { ...updatePayrollDraftPayload, payrollRunId: fixture.approvedPayrollRunId, payrollMonth: "2026-07-01", businessDate: "2026-08-20", idempotencyKey: randomUUID() } }),
    409,
    "CONFLICT",
    "A non-draft payroll run must reject updates.",
  );
  const emptyAdvanceSearch = await server.inject({ method: "GET", url: "/v1/hr/advances?search=missing&pageSize=1", headers: managerHeaders });
  assert.equal(emptyAdvanceSearch.statusCode, 200, emptyAdvanceSearch.body);
  assert.deepEqual(emptyAdvanceSearch.json().advances, []);

  const firstSettlementPage = await server.inject({ method: "GET", url: "/v1/hr/final-settlements?pageSize=1", headers: managerHeaders });
  assert.equal(firstSettlementPage.statusCode, 200, firstSettlementPage.body);
  assert.equal(firstSettlementPage.json().hasMore, true);
  const settlementNumberSearch = await server.inject({ method: "GET", url: "/v1/hr/final-settlements?search=TARGET-SETTLEMENT&pageSize=1", headers: managerHeaders });
  assert.equal(settlementNumberSearch.statusCode, 200, settlementNumberSearch.body);
  assert.deepEqual(settlementNumberSearch.json().settlements.map((settlement) => settlement.settlementNumber), ["FST-TARGET-SETTLEMENT"], "Final-settlement search must find records outside the first unfiltered page.");
  const settlementEmployeeSearch = await server.inject({ method: "GET", url: "/v1/hr/final-settlements?search=EMP-HTTP-002&pageSize=1", headers: managerHeaders });
  assert.equal(settlementEmployeeSearch.statusCode, 200, settlementEmployeeSearch.body);
  assert.deepEqual(settlementEmployeeSearch.json().settlements.map((settlement) => settlement.settlementNumber), ["FST-TARGET-SETTLEMENT"], "Final-settlement search must match employee number.");
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/final-settlements?search=TARGET-SETTLEMENT&pageSize=1&cursor=${firstSettlementPage.json().nextCursor}`, headers: managerHeaders }),
    400,
    "VALIDATION_FAILED",
    "A final-settlement cursor must remain bound to its search scope.",
  );

  const firstLetterPage = await server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}/letters?pageSize=2`, headers: managerHeaders });
  assert.equal(firstLetterPage.statusCode, 200, firstLetterPage.body);
  assert.equal(firstLetterPage.json().letters.length, 2);
  assert.equal(firstLetterPage.json().hasMore, true);
  assert.ok(firstLetterPage.json().nextCursor);
  const secondLetterPage = await server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}/letters?pageSize=2&cursor=${firstLetterPage.json().nextCursor}`, headers: managerHeaders });
  assert.equal(secondLetterPage.statusCode, 200, secondLetterPage.body);
  assert.equal(secondLetterPage.json().letters.length, 1);
  assert.equal(secondLetterPage.json().hasMore, false);
  assert.equal(secondLetterPage.json().nextCursor, null);
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.terminatedEmployeeId}/letters?pageSize=2&cursor=${firstLetterPage.json().nextCursor}`, headers: managerHeaders }),
    400,
    "VALIDATION_FAILED",
    "An employee-letter cursor must remain bound to its employee and company scope.",
  );

  const firstActivePage = await server.inject({ method: "GET", url: "/v1/hr/employees?pageSize=1", headers: managerHeaders });
  assert.equal(firstActivePage.statusCode, 200, firstActivePage.body);
  assert.equal(firstActivePage.json().hasMore, true);
  assert.ok(firstActivePage.json().nextCursor);
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/employees?status=TERMINATED&pageSize=1&cursor=${firstActivePage.json().nextCursor}`, headers: managerHeaders }),
    400,
    "VALIDATION_FAILED",
    "A cursor from another employee filter scope must be rejected as a client error.",
  );

  const createKey = randomUUID();
  const employeeRequest = {
    nameAr: "موظف فحص HTTP",
    nameEn: "HTTP verification employee",
    hireDate: "2026-01-01",
    idempotencyKey: createKey,
  };
  const created = await server.inject({ method: "POST", url: "/v1/hr/employees", headers: managerHeaders, payload: employeeRequest });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().replayed, false);
  const replay = await server.inject({ method: "POST", url: "/v1/hr/employees", headers: managerHeaders, payload: employeeRequest });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.json().id, created.json().id);
  assert.equal(replay.json().replayed, true);
  await expectError(
    server.inject({ method: "POST", url: "/v1/hr/employees", headers: managerHeaders, payload: { ...employeeRequest, nameEn: "Changed payload" } }),
    409,
    "CONFLICT",
    "A reused HR idempotency key with a different payload must conflict.",
  );
  await expectError(
    server.inject({ method: "GET", url: "/v1/hr/employees/not-a-uuid", headers: managerHeaders }),
    400,
    "VALIDATION_FAILED",
    "Malformed HR path identifiers must return 400 rather than 500.",
  );

  const reversalRequests = [
    ["/v1/hr/advances/reverse", "advanceId"],
    ["/v1/hr/services/reverse-cost", "serviceId"],
    ["/v1/hr/payroll-payments/reverse", "payrollPaymentId"],
    ["/v1/hr/final-settlement-payments/reverse", "finalSettlementPaymentId"],
  ];
  for (const [url, identifier] of reversalRequests) {
    const payload = { [identifier]: randomUUID(), businessDate: "2026-08-19", reason: "HTTP authorization verification", idempotencyKey: randomUUID() };
    await expectError(server.inject({ method: "POST", url, payload }), 401, "AUTHENTICATION_FAILED", `${url} must require authentication.`);
    await expectError(server.inject({ method: "POST", url, headers: readerHeaders, payload }), 403, "AUTHORIZATION_DENIED", `${url} must enforce its reversal capability.`);
    await expectError(
      server.inject({ method: "POST", url, headers: managerHeaders, payload: { ...payload, [identifier]: "not-a-uuid" } }),
      400,
      "VALIDATION_FAILED",
      `${url} must reject malformed identifiers before service execution.`,
    );
  }

  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/final-settlements/${randomUUID()}` }),
    401,
    "AUTHENTICATION_FAILED",
    "Final-settlement payment detail must require authentication.",
  );
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/final-settlements/${randomUUID()}`, headers: readerHeaders }),
    403,
    "AUTHORIZATION_DENIED",
    "Final-settlement payment detail must require hr.final_settlements.read.",
  );
  await expectError(
    server.inject({ method: "GET", url: "/v1/hr/final-settlements/not-a-uuid", headers: managerHeaders }),
    400,
    "VALIDATION_FAILED",
    "Final-settlement detail identifiers must be validated.",
  );
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}/documents` }),
    401,
    "AUTHENTICATION_FAILED",
    "Employee documents must use the common authentication error contract.",
  );
  await expectError(
    server.inject({ method: "GET", url: `/v1/hr/employees/${fixture.activeEmployeeId}/letters` }),
    401,
    "AUTHENTICATION_FAILED",
    "Employee letters must use the common authentication error contract.",
  );

  console.log("HR HTTP verification passed: authentication, company isolation, salary redaction, capability-aware overview, cursor/filter binding, idempotent writes, reversal-route authorization, UUID validation, and canonical error receipts.");
} finally {
  if (app) await app.close();
  await pool.end();
}

async function expectError(responsePromise, expectedStatus, expectedCode, message) {
  const response = await responsePromise;
  assert.equal(response.statusCode, expectedStatus, `${message} ${response.body}`);
  const receipt = response.json();
  assert.equal(receipt.error?.code, expectedCode, `${message} ${response.body}`);
  assert.equal(receipt.error?.retry?.kind, "do-not-retry", message);
  assert.match(receipt.error?.correlationId ?? "", /^[0-9a-f-]{36}$/i, message);
}

async function seedFixture() {
  const managerRoleId = randomUUID();
  const readerRoleId = randomUUID();
  const managerPasswordHash = await bcrypt.hash(`Manager-${suffix}`, 12);
  const readerPasswordHash = await bcrypt.hash(`Reader-${suffix}`, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, fixture.tenantCode, "HR HTTP verification"]);
    await client.query(
      'INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6), ($7::uuid, $2::uuid, $8, $9, $10, $11)',
      [fixture.managerUserId, fixture.tenantId, `hr-manager-${suffix}@baseer.test`, "مدير موارد بشرية", "HR manager", managerPasswordHash, fixture.readerUserId, `hr-reader-${suffix}@baseer.test`, "قارئ موارد بشرية", "HR reader", readerPasswordHash],
    );
    await client.query(
      'INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)',
      [fixture.companyId, fixture.tenantId, "شركة فحص الموارد البشرية", "HR verification company", fixture.foreignCompanyId, "شركة خارج النطاق", "Out-of-scope company"],
    );
    await client.query(
      'INSERT INTO "Role" ("id", "tenantId", "code", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4, $5), ($6::uuid, $2::uuid, $7, $8, $9)',
      [managerRoleId, fixture.tenantId, `HR_MANAGER_${suffix}`, "مدير الموارد البشرية", "HR manager", readerRoleId, `HR_READER_${suffix}`, "قارئ الموارد البشرية", "HR reader"],
    );
    const managerCapabilities = [
      "hr.employees.read",
      "hr.employees.write",
      "hr.payroll.read",
      "hr.payroll.create",
      "hr.final_settlements.read",
      "hr.leaves.read",
      "hr.advances.read",
      "hr.deductions.read",
      "hr.deductions.manage",
      "hr.advances.reverse",
      "hr.payroll.reverse",
      "hr.final_settlements.reverse",
      "finance.purchase_expense.cancel",
      "hr.employee_documents.read",
      "hr.employee_letters.read",
    ];
    for (const capability of managerCapabilities) {
      await client.query('INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3)', [fixture.tenantId, managerRoleId, capability]);
    }
    await client.query('INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode") VALUES ($1::uuid, $2::uuid, $3)', [fixture.tenantId, readerRoleId, "hr.employees.read"]);
    await client.query(
      'INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid), ($1::uuid, $5::uuid, $3::uuid, $6::uuid)',
      [fixture.tenantId, fixture.managerUserId, fixture.companyId, managerRoleId, fixture.readerUserId, readerRoleId],
    );
    await client.query(
      `INSERT INTO "HrEmployee" ("id", "tenantId", "companyId", "employeeNumber", "nameAr", "nameEn", "jobTitle", "hireDate", "status", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'EMP-HTTP-001', 'موظف نشط', 'Active employee', 'HTTP Analyst', DATE '2026-01-01', 'ACTIVE', CURRENT_TIMESTAMP),
              ($4::uuid, $2::uuid, $3::uuid, 'EMP-HTTP-002', 'موظف منتهي', 'Terminated employee', 'Former role', DATE '2025-01-01', 'TERMINATED', CURRENT_TIMESTAMP)`,
      [fixture.activeEmployeeId, fixture.tenantId, fixture.companyId, fixture.terminatedEmployeeId],
    );
    await client.query(
      `INSERT INTO "HrEmployeeCompensationProfile" ("id", "tenantId", "companyId", "employeeId", "effectiveFrom", "effectiveTo", "monthlyGross", "createdByUserId", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, DATE '2026-01-01', NULL, 7000.0000, $5::uuid, CURRENT_TIMESTAMP),
              ($6::uuid, $2::uuid, $3::uuid, $4::uuid, DATE '2025-07-01', DATE '2025-12-31', 6500.0000, $5::uuid, CURRENT_TIMESTAMP),
              ($7::uuid, $2::uuid, $3::uuid, $4::uuid, DATE '2025-01-01', DATE '2025-06-30', 6000.0000, $5::uuid, CURRENT_TIMESTAMP)`,
      [randomUUID(), fixture.tenantId, fixture.companyId, fixture.activeEmployeeId, fixture.managerUserId, randomUUID(), randomUUID()],
    );
    await client.query(
      `INSERT INTO "HrPayrollRun" ("id", "tenantId", "companyId", "runNumber", "payrollMonth", "businessDate", "status", "employeeCount", "grossAmount", "advanceSettlementAmount", "administrativeDeductionAmount", "netPayableAmount", "createdByUserId", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'PAY-HTTP-CURRENT', DATE '2026-08-01', DATE '2026-08-20', 'DRAFT', 1, 2000.0000, 200.0000, 100.0000, 1700.0000, $4::uuid, CURRENT_TIMESTAMP),
              ($5::uuid, $2::uuid, $3::uuid, 'PAY-HTTP-TARGET', DATE '2026-07-01', DATE '2026-07-31', 'APPROVED', 1, 1000.0000, 100.0000, 50.0000, 850.0000, $4::uuid, CURRENT_TIMESTAMP),
              (gen_random_uuid(), $2::uuid, $3::uuid, 'PAY-HTTP-CANCELLED', DATE '2026-06-01', DATE '2026-06-30', 'REVERSED', 1, 9000.0000, 900.0000, 450.0000, 7650.0000, $4::uuid, CURRENT_TIMESTAMP)`,
      [fixture.payrollRunId, fixture.tenantId, fixture.companyId, fixture.managerUserId, fixture.approvedPayrollRunId],
    );
    await client.query(
      `INSERT INTO "HrEmployeeLeave" ("id", "tenantId", "companyId", "employeeId", "leaveType", "status", "startDate", "endDate", "actualReturnDate", "approvedByUserId", "returnedByUserId", "returnedAt", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'ANNUAL', 'APPROVED', DATE '2026-08-19', DATE '2026-08-21', NULL, $5::uuid, NULL, NULL, CURRENT_TIMESTAMP),
              ($6::uuid, $2::uuid, $3::uuid, $4::uuid, 'OTHER', 'APPROVED', DATE '2026-09-01', DATE '2026-09-03', NULL, $5::uuid, NULL, NULL, CURRENT_TIMESTAMP),
              ($7::uuid, $2::uuid, $3::uuid, $8::uuid, 'SICK', 'RETURNED', DATE '2026-07-01', DATE '2026-07-02', DATE '2026-07-02', $5::uuid, $5::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [randomUUID(), fixture.tenantId, fixture.companyId, fixture.activeEmployeeId, fixture.managerUserId, randomUUID(), randomUUID(), fixture.terminatedEmployeeId],
    );
    await client.query(
      `INSERT INTO "HrEmployeeService" ("id", "tenantId", "companyId", "employeeId", "serviceType", "referenceNumber", "expiryDate", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'OTHER', 'SVC-EXPIRED', DATE '2026-08-19', CURRENT_TIMESTAMP),
              ($5::uuid, $2::uuid, $3::uuid, $4::uuid, 'OTHER', 'SVC-DUE30', DATE '2026-09-01', CURRENT_TIMESTAMP),
              ($6::uuid, $2::uuid, $3::uuid, $4::uuid, 'OTHER', 'SVC-TARGET', DATE '2026-10-15', CURRENT_TIMESTAMP),
              ($7::uuid, $2::uuid, $3::uuid, $4::uuid, 'OTHER', 'SVC-NONE', NULL, CURRENT_TIMESTAMP)`,
      [randomUUID(), fixture.tenantId, fixture.companyId, fixture.activeEmployeeId, randomUUID(), randomUUID(), randomUUID()],
    );
    await client.query(
      `INSERT INTO "HrEmployeeService" ("id", "tenantId", "companyId", "employeeId", "serviceType", "referenceNumber", "updatedAt")
       SELECT gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'OTHER', 'SVC-BULK-' || series::text, CURRENT_TIMESTAMP
       FROM generate_series(1, 497) AS series`,
      [fixture.tenantId, fixture.companyId, fixture.activeEmployeeId],
    );
    await client.query(
      `INSERT INTO "HrFinalSettlement" ("id", "tenantId", "companyId", "employeeId", "settlementNumber", "status", "terminationDate", "terminationReason", "reasonEvidenceReference", "reasonVerificationStatus", "calculationPolicyVersion", "serviceDays", "eosWage", "fullAwardAmount", "entitlementFactor", "eosAmount", "otherCreditsAmount", "recoveryAmount", "netPayableAmount", "paidAmount", "snapshotJson", "snapshotSha256", "createdByUserId", "createdAt", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'FST-CURRENT', 'DRAFT', DATE '2026-08-20', 'RESIGNATION', 'HTTP current settlement', 'PENDING', 'SA-EOS-V1', 365, 1000.0000, 500.0000, 1.00000000, 500.0000, 0.0000, 0.0000, 500.0000, 0.0000, '{}'::jsonb, repeat('0', 64), $5::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
              ($6::uuid, $2::uuid, $3::uuid, $7::uuid, 'FST-TARGET-SETTLEMENT', 'DRAFT', DATE '2026-08-19', 'RESIGNATION', 'HTTP target settlement', 'PENDING', 'SA-EOS-V1', 365, 1000.0000, 500.0000, 1.00000000, 500.0000, 0.0000, 0.0000, 500.0000, 0.0000, '{}'::jsonb, repeat('1', 64), $5::uuid, CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day')`,
      [randomUUID(), fixture.tenantId, fixture.companyId, fixture.activeEmployeeId, fixture.managerUserId, randomUUID(), fixture.terminatedEmployeeId],
    );
    await client.query(
      `INSERT INTO "HrEmployeeLetter" ("id", "tenantId", "companyId", "employeeId", "letterType", "letterNumber", "templateVersion", "locale", "snapshotJson", "snapshotSha256", "issuedByUserId", "issuedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'SALARY_CERTIFICATE', 'LTR-HTTP-003', 'HR-LETTER-V1', 'en', '{}'::jsonb, repeat('3', 64), $5::uuid, CURRENT_TIMESTAMP),
              ($6::uuid, $2::uuid, $3::uuid, $4::uuid, 'SERVICE_CERTIFICATE', 'LTR-HTTP-002', 'HR-LETTER-V1', 'ar', '{}'::jsonb, repeat('2', 64), $5::uuid, CURRENT_TIMESTAMP - INTERVAL '1 minute'),
              ($7::uuid, $2::uuid, $3::uuid, $4::uuid, 'SALARY_CERTIFICATE', 'LTR-HTTP-001', 'HR-LETTER-V1', 'en', '{}'::jsonb, repeat('1', 64), $5::uuid, CURRENT_TIMESTAMP - INTERVAL '2 minutes'),
              ($8::uuid, $2::uuid, $3::uuid, $9::uuid, 'SERVICE_CERTIFICATE', 'LTR-HTTP-OTHER', 'HR-LETTER-V1', 'ar', '{}'::jsonb, repeat('4', 64), $5::uuid, CURRENT_TIMESTAMP - INTERVAL '3 minutes')`,
      [randomUUID(), fixture.tenantId, fixture.companyId, fixture.activeEmployeeId, fixture.managerUserId, randomUUID(), randomUUID(), randomUUID(), fixture.terminatedEmployeeId],
    );
    await client.query(
      `INSERT INTO "HrEmployeeAdministrativeDeduction" ("id", "tenantId", "companyId", "employeeId", "deductionNumber", "businessDate", "originalAmount", "remainingAmount", "description", "createdByUserId", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'DED-HTTP-001', DATE '2026-08-18', 10.0000, 10.0000, 'TARGET-DEDUCTION', $5::uuid, CURRENT_TIMESTAMP),
              ($6::uuid, $2::uuid, $3::uuid, $7::uuid, 'DED-HTTP-002', DATE '2026-08-17', 20.0000, 20.0000, 'Other deduction', $5::uuid, CURRENT_TIMESTAMP)`,
      [fixture.deductionId, fixture.tenantId, fixture.companyId, fixture.activeEmployeeId, fixture.managerUserId, randomUUID(), fixture.terminatedEmployeeId],
    );
    await client.query(
      `INSERT INTO "HrEmployeeAdministrativeDeduction" ("id", "tenantId", "companyId", "employeeId", "deductionNumber", "businessDate", "originalAmount", "remainingAmount", "description", "createdByUserId", "updatedAt")
       SELECT gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'DED-BULK-' || lpad(series::text, 3, '0'), DATE '2026-08-10', 1.0000, 1.0000, 'Payroll preview collection-cap verification', $4::uuid, CURRENT_TIMESTAMP
       FROM generate_series(1, 101) AS series`,
      [fixture.tenantId, fixture.companyId, fixture.activeEmployeeId, fixture.managerUserId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
