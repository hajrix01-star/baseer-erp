-- Bounds supplier due, payment, and outflow-document history reads as data grows.
CREATE INDEX "FinanceSupplierDue_tenant_company_status_date_id_idx"
ON "FinanceSupplierDue"("tenantId", "companyId", "status", "originalBusinessDate", "id");

CREATE INDEX "FinanceSupplierDue_tenant_company_supplier_date_id_idx"
ON "FinanceSupplierDue"("tenantId", "companyId", "supplierId", "originalBusinessDate", "id");

CREATE INDEX "FinanceSupplierDuePayment_tenant_company_due_date_id_idx"
ON "FinanceSupplierDuePayment"("tenantId", "companyId", "dueId", "businessDate", "id");

CREATE INDEX "FinanceSupplierDuePayment_tenant_company_status_date_id_idx"
ON "FinanceSupplierDuePayment"("tenantId", "companyId", "status", "businessDate", "id");

CREATE INDEX "FinanceOutflowDocument_tenant_company_date_created_id_idx"
ON "FinanceOutflowDocument"("tenantId", "companyId", "businessDate", "createdAt", "id");
