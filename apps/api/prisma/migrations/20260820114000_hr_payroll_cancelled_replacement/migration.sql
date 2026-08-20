-- A cancelled payroll accrual is immutable audit history. It is not an active
-- payroll and must not prevent the company from calculating a replacement for
-- the same operational month. PostgreSQL partial unique indexes express this
-- lifecycle rule without mutating any historic row or journal.

ALTER TABLE "HrPayrollRun"
  DROP CONSTRAINT "HrPayrollRun_company_month_key";

CREATE UNIQUE INDEX "HrPayrollRun_company_month_active_key"
  ON "HrPayrollRun" ("companyId", "payrollMonth")
  WHERE "status" <> 'REVERSED';
