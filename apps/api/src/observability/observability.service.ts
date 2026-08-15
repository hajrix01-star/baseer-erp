import { Injectable } from '@nestjs/common';

import type { ObservabilitySummaryReceipt } from '@baseer-erp/contracts';

import { DatabaseService } from '../database/database.service.js';

const LATENCY_BUCKETS = [10, 50, 100, 250, 500, 1_000, 5_000] as const;
const MAX_METRIC_SERIES = 256;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

interface RequestMetric {
  readonly method: ObservabilitySummaryReceipt['metrics'][number]['method'];
  readonly route: string;
  readonly statusClass: ObservabilitySummaryReceipt['metrics'][number]['statusClass'];
  count: number;
  readonly buckets: number[];
}

@Injectable()
export class ObservabilityService {
  private readonly metrics = new Map<string, RequestMetric>();
  private droppedMetricSeries = 0;

  constructor(private readonly database: DatabaseService) {}

  recordRequest(input: {
    method: string;
    route: string | undefined;
    statusCode: number;
    elapsedMilliseconds: number;
    correlationId: string;
  }): void {
    const method = this.method(input.method);
    const route = this.route(input.route);
    const statusClass = this.statusClass(input.statusCode);
    const key = `${method}:${route}:${statusClass}`;
    let metric = this.metrics.get(key);
    if (!metric) {
      if (this.metrics.size >= MAX_METRIC_SERIES) {
        this.droppedMetricSeries += 1;
        this.write({
          level: 'warn',
          event: 'observability.metric_series_dropped',
          correlationId: input.correlationId,
        });
        return;
      }
      metric = { method, route, statusClass, count: 0, buckets: Array.from({ length: LATENCY_BUCKETS.length + 1 }, () => 0) };
      this.metrics.set(key, metric);
    }
    metric.count += 1;
    const elapsed = Math.max(0, Math.ceil(input.elapsedMilliseconds));
    const bucket = LATENCY_BUCKETS.findIndex((maximum) => elapsed <= maximum);
    const bucketIndex = bucket === -1 ? LATENCY_BUCKETS.length : bucket;
    metric.buckets[bucketIndex] = (metric.buckets[bucketIndex] ?? 0) + 1;
    this.write({
      level: statusClass === '5xx' ? 'error' : 'info',
      event: statusClass === '5xx' ? 'http.request_failed' : 'http.request_completed',
      correlationId: input.correlationId,
      method,
      route,
      statusCode: input.statusCode,
      elapsedMilliseconds: elapsed,
    });
  }

  async readiness(): Promise<'ready' | 'not_ready'> {
    try {
      await this.database.client.$queryRaw`SELECT 1`;
      return 'ready';
    } catch {
      return 'not_ready';
    }
  }

  async summary(): Promise<ObservabilitySummaryReceipt> {
    return {
      readiness: await this.readiness(),
      metrics: [...this.metrics.values()].map((metric) => ({
        method: metric.method,
        route: metric.route,
        statusClass: metric.statusClass,
        count: metric.count,
        latencyBuckets: metric.buckets.map((count, index) => ({
          lessThanOrEqualMs: index < LATENCY_BUCKETS.length
            ? String(LATENCY_BUCKETS[index]) as '10' | '50' | '100' | '250' | '500' | '1000' | '5000'
            : 'inf',
          count,
        })),
      })),
      droppedMetricSeries: this.droppedMetricSeries,
    };
  }

  logLifecycle(event: 'service.started' | 'service.stopped'): void {
    this.write({ level: 'info', event });
  }

  private write(fields: Record<string, string | number>): void {
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...fields })}\n`;
    if (fields['level'] === 'error') {
      process.stderr.write(line);
      return;
    }
    process.stdout.write(line);
  }

  private method(value: string): RequestMetric['method'] {
    return (ALLOWED_METHODS.has(value) ? value : 'GET') as RequestMetric['method'];
  }

  private route(value: string | undefined): string {
    if (!value || value.length > 160 || !value.startsWith('/')) return '/unmatched';
    return value;
  }

  private statusClass(value: number): RequestMetric['statusClass'] {
    if (value >= 500) return '5xx';
    if (value >= 400) return '4xx';
    if (value >= 300) return '3xx';
    return '2xx';
  }
}
