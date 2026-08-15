import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'ready', 'not_ready']);
export const healthReceiptSchema = z.object({
  status: healthStatusSchema,
  service: z.literal('baseer-erp-api'),
}).strict();

export const requestMetricStatusClassSchema = z.enum(['2xx', '3xx', '4xx', '5xx']);
export const requestLatencyBucketSchema = z.enum(['10', '50', '100', '250', '500', '1000', '5000', 'inf']);
export const requestMetricSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
  route: z.string().min(1).max(160),
  statusClass: requestMetricStatusClassSchema,
  count: z.number().int().nonnegative(),
  latencyBuckets: z.array(z.object({
    lessThanOrEqualMs: requestLatencyBucketSchema,
    count: z.number().int().nonnegative(),
  }).strict()).max(8),
}).strict();

export const observabilitySummaryReceiptSchema = z.object({
  readiness: z.enum(['ready', 'not_ready']),
  metrics: z.array(requestMetricSchema).max(256),
  droppedMetricSeries: z.number().int().nonnegative(),
}).strict();

export type HealthReceipt = z.infer<typeof healthReceiptSchema>;
export type ObservabilitySummaryReceipt = z.infer<typeof observabilitySummaryReceiptSchema>;
