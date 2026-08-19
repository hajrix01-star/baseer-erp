-- An Iqama number is employee master data. Its lifecycle, expiry and costs
-- remain separate employee-service records and never post from onboarding.
ALTER TABLE "HrEmployee" ADD COLUMN "iqamaNumber" VARCHAR(160);
