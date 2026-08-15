import { z } from 'zod';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export const businessDateSchema = z.string().regex(DATE_PATTERN).refine(isGregorianDate, 'Invalid Gregorian date.');
export const businessMonthSchema = z.string().regex(MONTH_PATTERN).refine(isGregorianMonth, 'Invalid Gregorian month.');

export const businessDateIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current') }).strict(),
  z.object({ kind: z.literal('date'), businessDate: businessDateSchema }).strict(),
  z.object({ kind: z.literal('month'), month: businessMonthSchema }).strict(),
  z.object({ kind: z.literal('range'), startDate: businessDateSchema, endDate: businessDateSchema }).strict(),
]);

export const businessDateResolveRequestSchema = z.object({
  intent: businessDateIntentSchema,
}).strict();

export const businessDateResolutionSchema = z.object({
  timezone: z.literal('Asia/Riyadh'),
  businessDate: businessDateSchema,
  generatedAt: z.string().datetime({ offset: true }),
  range: z.object({ startDate: businessDateSchema, endDate: businessDateSchema }).strict(),
}).strict();

export type BusinessDateIntent = z.infer<typeof businessDateIntentSchema>;
export type BusinessDateResolveRequest = z.infer<typeof businessDateResolveRequestSchema>;
export type BusinessDateResolution = z.infer<typeof businessDateResolutionSchema>;

function isGregorianMonth(value: string): boolean {
  const month = Number(value.slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

function isGregorianDate(value: string): boolean {
  if (!isGregorianMonth(value.slice(0, 7))) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return Number.isInteger(year) && year >= 1 && day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
