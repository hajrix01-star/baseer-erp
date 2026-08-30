import { normalizeNurixCounterpartyAlias } from './nurix-counterparty-alias-resolution.js';

/**
 * A small, evidence-bound mapping layer for the ARZ V5 workbook.
 *
 * It is deliberately pure: it does not import XLSX files, query Prisma, or
 * create records. A future writer must resolve target *codes* to live IDs and
 * re-check the company, account, status, and payment-method invariants inside
 * its own transaction.
 */
export type NurixExcelReferenceRow = Readonly<{
  sourceId: string;
  nameAr: string;
  nameEn?: string | null;
}>;

export type ArzVaultReference = Readonly<{
  sourceId: string;
  sourceNameAr: string;
  targetVaultCode: 'V-001' | 'V-002' | 'V-003' | 'V-004' | 'V-005';
  targetNameAr: string;
  vaultType: 'CASH' | 'BANK' | 'APP';
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'BANK_CARD' | 'BANK_PAYMENT' | 'APP';
  evidence: 'ARZ_V5_EXPLICIT_VAULT_DECISION';
}>;

export type ArzVaultReferenceResolution =
  | Readonly<{ status: 'MATCHED'; mapping: ArzVaultReference }>
  | Readonly<{ status: 'REVIEW_REQUIRED'; reason: 'UNKNOWN_SOURCE_VAULT' | 'SOURCE_VAULT_EVIDENCE_MISMATCH' }>;

export type TargetSupplierReference = Readonly<{
  id: string;
  nameAr: string;
}>;

export type SupplierReferenceResolution =
  | Readonly<{ status: 'MATCHED'; targetSupplierId: string; match: 'EXACT_NORMALIZED_NAME' }>
  | Readonly<{ status: 'CREATE'; create: Readonly<{ nameAr: string; nameEn: string | null }> }>
  | Readonly<{ status: 'REVIEW_REQUIRED'; reason: 'SOURCE_SUPPLIER_NAME_MISSING' | 'TARGET_SUPPLIER_NAME_AMBIGUOUS' }>;

/**
 * The only approved vault decisions for the specific ARZ V5 package. Source
 * IDs and names are both part of the evidence; matching by a similar name is
 * intentionally impossible.
 */
export const ARZ_V5_VAULT_REFERENCES: readonly ArzVaultReference[] = [
  { sourceId: 'cmnf604l100a6y8lm6h3y6ocx', sourceNameAr: 'بنك', targetVaultCode: 'V-002', targetNameAr: 'بنك', vaultType: 'BANK', paymentMethod: 'BANK_TRANSFER', evidence: 'ARZ_V5_EXPLICIT_VAULT_DECISION' },
  { sourceId: 'cmnf604kz00a4y8lm5gvqxsho', sourceNameAr: 'نقد', targetVaultCode: 'V-001', targetNameAr: 'نقد', vaultType: 'CASH', paymentMethod: 'CASH', evidence: 'ARZ_V5_EXPLICIT_VAULT_DECISION' },
  { sourceId: 'cmnw3fmrg000410l28jrx8z6n', sourceNameAr: 'Sifi', targetVaultCode: 'V-003', targetNameAr: 'Sifi', vaultType: 'CASH', paymentMethod: 'CASH', evidence: 'ARZ_V5_EXPLICIT_VAULT_DECISION' },
  { sourceId: 'cms1r3qa3006alqrkdew6vg2b', sourceNameAr: 'حسابي الشخصي', targetVaultCode: 'V-004', targetNameAr: 'حسابي الشخصي', vaultType: 'BANK', paymentMethod: 'BANK_TRANSFER', evidence: 'ARZ_V5_EXPLICIT_VAULT_DECISION' },
  { sourceId: 'cmsje77wt007tvj7eb63szg0y', sourceNameAr: 'عبدالجيل', targetVaultCode: 'V-005', targetNameAr: 'عبدالجيل', vaultType: 'CASH', paymentMethod: 'CASH', evidence: 'ARZ_V5_EXPLICIT_VAULT_DECISION' },
] as const;

/** Rejects a hand-edited decision set before it can be passed to an importer. */
export function assertArzVaultReferencesAreSafe(references: readonly ArzVaultReference[] = ARZ_V5_VAULT_REFERENCES): void {
  const sourceIds = new Set<string>();
  const sourceNames = new Set<string>();
  const targetCodes = new Set<string>();
  for (const reference of references) {
    const sourceId = reference.sourceId.trim();
    const sourceName = normalizeNurixCounterpartyAlias(reference.sourceNameAr);
    if (!sourceId || !sourceName || !reference.targetNameAr.trim()) throw new Error('ARZ_VAULT_REFERENCE_INVALID');
    if (sourceIds.has(sourceId) || sourceNames.has(sourceName) || targetCodes.has(reference.targetVaultCode)) throw new Error('ARZ_VAULT_REFERENCE_DUPLICATE');
    if (reference.evidence !== 'ARZ_V5_EXPLICIT_VAULT_DECISION') throw new Error('ARZ_VAULT_REFERENCE_EVIDENCE_INVALID');
    if (reference.vaultType === 'CASH' && reference.paymentMethod !== 'CASH') throw new Error('ARZ_VAULT_REFERENCE_PAYMENT_INVALID');
    if (reference.vaultType === 'BANK' && reference.paymentMethod !== 'BANK_TRANSFER') throw new Error('ARZ_VAULT_REFERENCE_PAYMENT_INVALID');
    sourceIds.add(sourceId); sourceNames.add(sourceName); targetCodes.add(reference.targetVaultCode);
  }
  if (references.length !== 5) throw new Error('ARZ_VAULT_REFERENCE_SET_INCOMPLETE');
}

export function resolveArzV5VaultReference(source: NurixExcelReferenceRow, references: readonly ArzVaultReference[] = ARZ_V5_VAULT_REFERENCES): ArzVaultReferenceResolution {
  const sourceId = source.sourceId.trim();
  const sourceName = normalizeNurixCounterpartyAlias(source.nameAr);
  const mapping = references.find((reference) => reference.sourceId === sourceId);
  if (!mapping) return { status: 'REVIEW_REQUIRED', reason: 'UNKNOWN_SOURCE_VAULT' };
  if (!sourceName || sourceName !== normalizeNurixCounterpartyAlias(mapping.sourceNameAr)) return { status: 'REVIEW_REQUIRED', reason: 'SOURCE_VAULT_EVIDENCE_MISMATCH' };
  return { status: 'MATCHED', mapping };
}

/**
 * Exact canonical-name matching for company-scoped suppliers. There is no
 * transliteration, similarity scoring, central-identity inference, or update
 * path here: one exact target match is reused; none produces a create
 * candidate; duplicate target evidence stops for review.
 */
export function resolveSupplierReference(source: NurixExcelReferenceRow, existing: readonly TargetSupplierReference[]): SupplierReferenceResolution {
  const sourceName = source.nameAr.trim();
  const normalized = normalizeNurixCounterpartyAlias(sourceName);
  if (!normalized) return { status: 'REVIEW_REQUIRED', reason: 'SOURCE_SUPPLIER_NAME_MISSING' };
  const matches = existing.filter((supplier) => supplier.id.trim() !== '' && normalizeNurixCounterpartyAlias(supplier.nameAr) === normalized);
  if (matches.length === 1) return { status: 'MATCHED', targetSupplierId: matches[0]!.id, match: 'EXACT_NORMALIZED_NAME' };
  if (matches.length > 1) return { status: 'REVIEW_REQUIRED', reason: 'TARGET_SUPPLIER_NAME_AMBIGUOUS' };
  return { status: 'CREATE', create: { nameAr: sourceName, nameEn: source.nameEn?.trim() || null } };
}
