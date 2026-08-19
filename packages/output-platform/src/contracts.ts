export const OUTPUT_FORMATS = ['preview', 'xlsx'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export type ReportLocale = 'ar' | 'en';
export type ReportDirection = 'rtl' | 'ltr';
export type TaxPresentation = 'gross' | 'taxSeparated';

export interface OutputActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly permissions: readonly string[];
}

export interface OutputScope {
  readonly companyIds: readonly string[];
}

export interface OutputRequest {
  readonly reportCode: string;
  readonly format: OutputFormat;
  readonly locale: ReportLocale;
  readonly scope: OutputScope;
  readonly filters: Readonly<Record<string, string | number | boolean | null>>;
  readonly taxPresentation: TaxPresentation;
  readonly idempotencyKey: string;
}

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly kind: 'text' | 'integer' | 'amount' | 'percent' | 'date';
  readonly width?: number;
}

export interface ReportSnapshot {
  readonly snapshotId: string;
  readonly reportCode: string;
  readonly templateVersion: string;
  readonly title: string;
  readonly direction: ReportDirection;
  readonly locale: ReportLocale;
  readonly generatedAtRiyadh: string;
  readonly companies: readonly { readonly id: string; readonly name: string }[];
  /** Optional server-embedded logo. Print previews must never depend on the application chrome. */
  readonly companyLogoDataUri?: string | null;
  readonly periodLabel: string;
  readonly taxPresentation: TaxPresentation;
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly Readonly<Record<string, string | number | null>>[];
  readonly sourceLabel: string;
  /** A centrally rendered document variant; reports remain server-snapshotted. */
  readonly template?: 'table' | 'payroll-signature-slips';
  readonly payrollSignatureSlips?: readonly PayrollSignatureSlip[];
}

export interface PayrollSignatureSlip {
  readonly employeeNumber: string;
  readonly employeeName: string;
  readonly gross: string | number;
  readonly advances: string | number;
  readonly deductions: string | number;
  readonly net: string | number;
  readonly paid: string | number;
}

export interface OutputAuthorization {
  readonly allowed: boolean;
  readonly deniedCode?: 'OUTPUT_FORBIDDEN' | 'OUTPUT_SCOPE_FORBIDDEN';
}

export interface ReportDefinition {
  readonly code: string;
  authorize(actor: OutputActor, request: OutputRequest): Promise<OutputAuthorization>;
  createSnapshot(actor: OutputActor, request: OutputRequest): Promise<ReportSnapshot>;
}

export interface OutputArtifact {
  readonly snapshotId: string;
  readonly format: OutputFormat;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}
