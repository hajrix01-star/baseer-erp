-- A compensation agreement may state one monthly total inclusive of overtime.
-- Existing payroll profiles and historical lines retain their fixed-salary meaning.
CREATE TYPE "HrCompensationMethod" AS ENUM ('FIXED_MONTHLY', 'INCLUSIVE_OVERTIME');

ALTER TABLE "HrEmployeeCompensationProfile"
  ADD COLUMN "compensationMethod" "HrCompensationMethod" NOT NULL DEFAULT 'FIXED_MONTHLY',
  ADD COLUMN "foodAllowance" decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "otherAllowance" decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "scheduledHoursPerDay" integer,
  ADD COLUMN "scheduledWorkDays" integer;

ALTER TABLE "HrPayrollLine"
  ADD COLUMN "compensationMethod" "HrCompensationMethod" NOT NULL DEFAULT 'FIXED_MONTHLY',
  ADD COLUMN "basicSalary" decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "foodAllowance" decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "otherAllowance" decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeAmount" decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeHours" decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "scheduledHoursPerDay" integer,
  ADD COLUMN "scheduledWorkDays" integer;

-- A historical fixed salary was its entire gross amount; preserve that snapshot.
UPDATE "HrPayrollLine"
SET "basicSalary" = "grossSalary"
WHERE "compensationMethod" = 'FIXED_MONTHLY';
