import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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
  userId: randomUUID(),
  policyId: randomUUID(),
  tenantCode: `hr-onboarding-${suffix}`,
};
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = fixture.tenantCode;
  const [{ AppModule }, { HrPayrollService }, { HrService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/hr/hr-payroll.service.js"),
    import("../apps/api/dist/hr/hr.service.js"),
  ]);
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  await app.init();

  const payroll = app.get(HrPayrollService);
  const hr = app.get(HrService);
  const context = { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.userId };
  const monthStart = new Date(`${riyadhDate().slice(0, 7)}-01T00:00:00.000Z`);
  const onboardingKey = randomUUID();
  const onboardingInput = {
    nameAr: "موظف اختبار الحفظ",
    nameEn: "Onboarding persistence test",
    jobTitle: "بائع",
    hireDate: monthStart,
    initialCompensation: {
      monthlyGross: "5000.0000",
      compensationMethod: "FIXED_MONTHLY",
      foodAllowance: "0.0000",
      housingAllowance: "0.0000",
      transportAllowance: "0.0000",
      otherAllowance: "0.0000",
    },
  };
  const receipt = await payroll.onboardEmployee(context, onboardingInput, onboardingKey);
  const onboardingReplay = await payroll.onboardEmployee(context, onboardingInput, onboardingKey);

  assert.equal(onboardingReplay.id, receipt.id, "Replaying onboarding must return the original employee.");
  assert.equal(onboardingReplay.compensationId, receipt.compensationId, "Replaying onboarding must return the original salary.");

  const register = await hr.listEmployees(context, { pageSize: 50 });
  const detail = await hr.employeeDetail(context, receipt.id, { pageSize: 50 });
  assert.equal(register.employees.length, 1, "The saved employee must be visible in the company register.");
  assert.equal(register.employees[0]?.id, receipt.id, "The register must return the created employee.");
  assert.equal(register.employees[0]?.currentMonthlyGross, "5000.0000", "The register must return the current salary.");
  assert.equal(detail.compensation?.id, receipt.compensationId, "The employee file must return the salary created by onboarding.");
  assert.equal(detail.compensation?.monthlyGross, "5000.0000", "The employee file must persist the entered salary.");

  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const adjustmentKey = randomUUID();
  const adjustmentInput = {
    employeeId: receipt.id,
    policyVersionId: detail.compensation?.policyVersionId ?? undefined,
    effectiveFrom: nextMonthStart,
    monthlyGross: "5500.0000",
    compensationMethod: "FIXED_MONTHLY",
    foodAllowance: "0.0000",
    housingAllowance: "0.0000",
    transportAllowance: "0.0000",
    otherAllowance: "0.0000",
    notes: "زيادة راتب اختبارية",
  };
  const adjustment = await payroll.setCompensation(context, adjustmentInput, adjustmentKey);
  const adjustmentReplay = await payroll.setCompensation(context, adjustmentInput, adjustmentKey);
  const detailAfterAdjustment = await hr.employeeDetail(context, receipt.id, { pageSize: 50 });
  assert.equal(adjustmentReplay.id, adjustment.id, "Replaying a salary change must return the original salary record.");
  assert.equal(detailAfterAdjustment.compensationHistory.length, 2, "The employee file must retain both salary records.");
  assert.equal(detailAfterAdjustment.compensationHistory[0]?.monthlyGross, "5500.0000", "The future salary change must be visible in salary history.");
  assert.equal(detailAfterAdjustment.compensationHistory[1]?.monthlyGross, "5000.0000", "The initial salary must remain in salary history.");
  assert.equal(detailAfterAdjustment.compensation?.monthlyGross, "5000.0000", "A future salary change must not rewrite the currently effective salary early.");
  console.log("HR onboarding verification passed: policy recovery, atomic employee/salary save, safe replay, register visibility, employee-file readback, and dated salary history.");
} finally {
  if (app) await app.close();
  // The verification database role deliberately cannot delete immutable
  // audit rows. Fixtures are isolated by a random tenant instead of weakening
  // those database permissions for cleanup convenience.
  await pool.end();
}

async function seedFixture() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, fixture.tenantCode, "HR onboarding verification"]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [fixture.userId, fixture.tenantId, `${fixture.tenantCode}@baseer.test`, "مختبر الموارد البشرية", "HR verifier", "unused-test-hash"]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [fixture.companyId, fixture.tenantId, "شركة اختبار حفظ الموظف", "Employee persistence test"]);
    // Reproduce the legacy state that previously caused the internal error:
    // the standard policy container exists, but it has no approved version.
    await client.query('INSERT INTO "HrCompensationPolicy" ("id", "tenantId", "companyId", "code", "nameAr", "nameEn", "createdByUserId", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid, CURRENT_TIMESTAMP)', [fixture.policyId, fixture.tenantId, fixture.companyId, "BASEER_STANDARD", "سياسة قياسية غير مكتملة", "Incomplete standard policy", fixture.userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function riyadhDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const fields = new Map(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${fields.get("year")}-${fields.get("month")}-${fields.get("day")}`;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
