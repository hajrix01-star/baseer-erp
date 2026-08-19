-- Payroll V1 is a full-month calculation.  The selected eligibility treatment
-- is immutable on each payroll line for audit and future reporting.
CREATE TYPE "HrPayrollLineEligibilityCode" AS ENUM ('FULL_MONTH_V1', 'FULL_MONTH_ON_LEAVE_EXCEPTION_V1', 'FULL_MONTH_NEW_HIRE_EXCEPTION_V1');

ALTER TABLE "HrPayrollLine"
  ADD COLUMN "eligibilityCode" "HrPayrollLineEligibilityCode" NOT NULL DEFAULT 'FULL_MONTH_V1';
