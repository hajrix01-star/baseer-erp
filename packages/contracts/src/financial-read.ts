import { z } from 'zod';

/**
 * A small, versioned declaration for financial read models.  It is an
 * optional envelope so existing domain payloads keep their own precise
 * shapes and can adopt it without a breaking, cross-domain DTO migration.
 */
export const financialReadContractSchema = z.object({
  contractVersion: z.literal('financial-read.v1'),
  subject: z.enum(['SALES', 'CASH_MOVEMENT', 'PURCHASE_SPEND', 'MIXED_ANALYTICS']),
  defaultTaxView: z.literal('VAT_INCLUDED'),
  allowedTaxViews: z.array(z.enum(['VAT_INCLUDED', 'VAT_SEPARATED'])).min(1).max(2),
  authority: z.string().min(1).max(120),
  /** Readiness is descriptive only; each domain retains its existing result state. */
  quality: z.enum(['READY', 'INCOMPLETE', 'NO_DATA', 'NOT_READY', 'STALE', 'UNAVAILABLE', 'CONFLICTED']),
  /** A scalar currency is valid only for a one-currency financial read. */
  currencyScope: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('SINGLE_CURRENCY'), currencyCode: z.string().regex(/^[A-Z]{3}$/) }).strict(),
    z.object({ mode: z.literal('MIXED_OR_UNCONFIGURED') }).strict(),
  ]),
  presentationPolicy: z.literal('SERVER_FORMATTED'),
}).strict().superRefine((value, context) => {
  if (!value.allowedTaxViews.includes(value.defaultTaxView)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowedTaxViews'],
      message: 'The default tax view must be available to the client.',
    });
  }
});

export type FinancialReadContract = z.infer<typeof financialReadContractSchema>;
