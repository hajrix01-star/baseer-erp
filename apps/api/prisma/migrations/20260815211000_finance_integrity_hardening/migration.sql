-- BASEER ERP finance integrity hardening. This migration is additive and does not alter Noorix.

-- An event is evidence, not mutable application data. Corrections must be new events.
CREATE FUNCTION "baseer_prevent_audit_event_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only and cannot be updated or deleted.';
END;
$$;

CREATE TRIGGER "AuditEvent_prevent_update_delete"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_audit_event_mutation"();

-- Service checks are helpful, but the database must also reject overlapping company periods.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "FinanceFiscalPeriod"
  ADD CONSTRAINT "FinanceFiscalPeriod_company_date_range_no_overlap"
  EXCLUDE USING gist (
    "companyId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  );
