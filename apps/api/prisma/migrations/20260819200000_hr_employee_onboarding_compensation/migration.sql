-- Preserve historic payroll snapshots; the new allowance components begin at zero.
ALTER TABLE "HrEmployee" ADD COLUMN "workSchedule" VARCHAR(160);
ALTER TABLE "HrEmployeeCompensationProfile" ADD COLUMN "housingAllowance" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "HrEmployeeCompensationProfile" ADD COLUMN "transportAllowance" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "HrPayrollLine" ADD COLUMN "housingAllowance" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "HrPayrollLine" ADD COLUMN "transportAllowance" DECIMAL(18,4) NOT NULL DEFAULT 0;
