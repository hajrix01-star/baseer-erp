-- Operations O3 hardening: preserve conversion snapshots, make receipt reversal
-- explicit and append-only, and protect operational ledgers from direct mutation.

ALTER TABLE "OperationsPurchaseReceipt"
  ADD COLUMN "reversedAt" TIMESTAMPTZ(6),
  ADD COLUMN "reversedByUserId" UUID,
  ADD COLUMN "reversalReason" VARCHAR(1000);

ALTER TABLE "OperationsPurchaseRequest"
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(6),
  ADD COLUMN "cancelledByUserId" UUID,
  ADD COLUMN "cancellationReason" VARCHAR(1000);

ALTER TABLE "OperationsPurchaseReceiptLine"
  ADD COLUMN "conversionVersionId" UUID;

ALTER TABLE "OperationsPurchaseRequestLine"
  ADD CONSTRAINT "OperationsPurchaseRequestLine_id_tenantId_companyId_key"
  UNIQUE ("id", "tenantId", "companyId");

ALTER TABLE "OperationsInventoryBalance"
  ALTER COLUMN "weightedUnitCost" TYPE DECIMAL(26,12);

ALTER TABLE "OperationsInventoryMovement"
  ALTER COLUMN "weightedUnitCostAfter" TYPE DECIMAL(26,12);

ALTER TABLE "OperationsRecipeLine"
  ADD CONSTRAINT "OperationsRecipeLine_conversionVersionId_tenantId_companyId_fkey"
  FOREIGN KEY ("conversionVersionId", "tenantId", "companyId")
  REFERENCES "OperationsItemConversionVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT;

ALTER TABLE "OperationsPurchaseRequestLine"
  ADD CONSTRAINT "OperationsPurchaseRequestLine_conversionVersionId_tenantId_companyId_fkey"
  FOREIGN KEY ("conversionVersionId", "tenantId", "companyId")
  REFERENCES "OperationsItemConversionVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT;

ALTER TABLE "OperationsPurchaseReceiptLine"
  ADD CONSTRAINT "OperationsPurchaseReceiptLine_conversionVersionId_tenantId_companyId_fkey"
  FOREIGN KEY ("conversionVersionId", "tenantId", "companyId")
  REFERENCES "OperationsItemConversionVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT;

ALTER TABLE "OperationsPurchaseReceiptLine"
  DROP CONSTRAINT "OperationsPurchaseReceiptLine_requestLineId_fkey",
  ADD CONSTRAINT "OperationsPurchaseReceiptLine_requestLineId_tenantId_companyId_fkey"
  FOREIGN KEY ("requestLineId", "tenantId", "companyId")
  REFERENCES "OperationsPurchaseRequestLine"("id", "tenantId", "companyId") ON DELETE RESTRICT;

ALTER TABLE "OperationsPurchaseReceipt"
  ADD CONSTRAINT "OperationsPurchaseReceipt_reversedByUserId_tenantId_fkey"
  FOREIGN KEY ("reversedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT;

ALTER TABLE "OperationsPurchaseRequest"
  ADD CONSTRAINT "OperationsPurchaseRequest_cancelledByUserId_tenantId_fkey"
  FOREIGN KEY ("cancelledByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT;

CREATE FUNCTION "operations_block_append_only_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Operations ledger rows are append-only; use an operational reversal instead.';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "operations_guard_receipt_reversal"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Purchase receipts are append-only; use a reversal instead.';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'reversedAt' - 'reversedByUserId' - 'reversalReason')
      IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'reversedAt' - 'reversedByUserId' - 'reversalReason')
     OR OLD."status" <> 'POSTED'
     OR NEW."status" <> 'REVERSED'
     OR NEW."reversedAt" IS NULL
     OR NEW."reversedByUserId" IS NULL
     OR NEW."reversalReason" IS NULL THEN
    RAISE EXCEPTION 'A purchase receipt can only move once from POSTED to REVERSED.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "operations_guard_published_version"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published operational versions are immutable.';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
     OR OLD."status" <> 'PUBLISHED'
     OR NEW."status" <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'A published operational version can only move once to SUPERSEDED.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "operations_guard_purchase_request"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Purchase requests are immutable; cancel or reverse operational effects instead.';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'receivedAt' - 'cancelledAt' - 'cancelledByUserId' - 'cancellationReason' - 'updatedAt')
      IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'receivedAt' - 'cancelledAt' - 'cancelledByUserId' - 'cancellationReason' - 'updatedAt') THEN
    RAISE EXCEPTION 'Purchase request business data is immutable after creation.';
  END IF;
  IF OLD."status" = 'CANCELLED'
     OR (NEW."status" = 'CANCELLED' AND (OLD."status" <> 'PENDING_RECEIPT' OR NEW."cancellationReason" IS NULL OR NEW."cancelledAt" IS NULL OR NEW."cancelledByUserId" IS NULL)) THEN
    RAISE EXCEPTION 'Only a pending purchase request can be cancelled with documented responsibility.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperationsPurchaseReceipt_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsPurchaseReceipt"
  FOR EACH ROW EXECUTE FUNCTION "operations_guard_receipt_reversal"();

CREATE TRIGGER "OperationsItemConversionVersion_immutable"
  BEFORE UPDATE OR DELETE ON "OperationsItemConversionVersion"
  FOR EACH ROW EXECUTE FUNCTION "operations_guard_published_version"();

CREATE TRIGGER "OperationsRecipeVersion_immutable"
  BEFORE UPDATE OR DELETE ON "OperationsRecipeVersion"
  FOR EACH ROW EXECUTE FUNCTION "operations_guard_published_version"();

CREATE TRIGGER "OperationsItemConversionEdge_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsItemConversionEdge"
  FOR EACH ROW EXECUTE FUNCTION "operations_block_append_only_mutation"();

CREATE TRIGGER "OperationsRecipeLine_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsRecipeLine"
  FOR EACH ROW EXECUTE FUNCTION "operations_block_append_only_mutation"();

CREATE TRIGGER "OperationsPurchaseRequest_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsPurchaseRequest"
  FOR EACH ROW EXECUTE FUNCTION "operations_guard_purchase_request"();

CREATE TRIGGER "OperationsPurchaseRequestLine_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsPurchaseRequestLine"
  FOR EACH ROW EXECUTE FUNCTION "operations_block_append_only_mutation"();

CREATE TRIGGER "OperationsPurchaseReceiptLine_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsPurchaseReceiptLine"
  FOR EACH ROW EXECUTE FUNCTION "operations_block_append_only_mutation"();

CREATE TRIGGER "OperationsCustodyEvent_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsCustodyEvent"
  FOR EACH ROW EXECUTE FUNCTION "operations_block_append_only_mutation"();

CREATE TRIGGER "OperationsInventoryMovement_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsInventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION "operations_block_append_only_mutation"();

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", permission.code
FROM "Role" role CROSS JOIN (VALUES
  ('operations.purchase_request.cancel'),
  ('operations.purchase_receipt.reverse')
) AS permission(code)
WHERE role."code" = 'BASEER_COMPANY_MANAGER'
ON CONFLICT DO NOTHING;
