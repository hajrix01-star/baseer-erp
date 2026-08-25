-- Inventory balances are maintained by application-level advisory locks. These
-- constraints are a final database guard against accidental negative snapshots
-- from future maintenance or alternate write paths.
ALTER TABLE "OperationsInventoryBalance"
  ADD CONSTRAINT "OperationsInventoryBalance_non_negative_values"
  CHECK (
    "baseQuantity" >= 0
    AND "totalValue" >= 0
    AND "weightedUnitCost" >= 0
  );

ALTER TABLE "OperationsInventoryMovement"
  ADD CONSTRAINT "OperationsInventoryMovement_non_negative_snapshots"
  CHECK (
    "quantityAfter" >= 0
    AND "valueAfter" >= 0
    AND "weightedUnitCostAfter" >= 0
  );
