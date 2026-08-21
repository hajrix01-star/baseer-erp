-- Historical management valuation for internal registrations.
-- These values are never projected by the staff-facing workstation endpoint.
ALTER TABLE "OperationsInternalRegistrationLine"
  ADD COLUMN "menuSaleUnitPriceSnapshot" DECIMAL(18, 4),
  ADD COLUMN "lineTotalSnapshot" DECIMAL(18, 4);
