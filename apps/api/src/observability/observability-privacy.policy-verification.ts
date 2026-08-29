import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ObservabilityService } from './observability.service.js';

const service = new ObservabilityService({
  client: { $queryRaw: async () => [{ ok: 1 }] },
} as never);

const captured: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string | Uint8Array) => {
  captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  return true;
}) as typeof process.stdout.write;

try {
  // Extra values model unsafe caller data. The metric boundary must ignore them
  // completely: logs contain only the aggregate-safe fields accepted by
  // recordRequest, never headers, bodies, credentials, query values, or SQL.
  service.recordRequest({
    method: 'GET',
    route: '/attendance/dashboard',
    statusCode: 200,
    elapsedMilliseconds: 42,
    correlationId: 'opaque-correlation-id',
    authorization: 'Bearer TOKEN_MUST_NOT_BE_LOGGED',
    headers: { cookie: 'COOKIE_MUST_NOT_BE_LOGGED' },
    body: { employeeName: 'PERSONAL_DATA_MUST_NOT_BE_LOGGED' },
    query: { employeeId: 'QUERY_VALUE_MUST_NOT_BE_LOGGED' },
    sql: 'SQL_MUST_NOT_BE_LOGGED',
  } as never);

  for (let index = 0; index < 256; index += 1) {
    service.recordRequest({ method: 'GET', route: `/bounded-route-${index}`, statusCode: 200, elapsedMilliseconds: 1, correlationId: 'opaque-correlation-id' });
  }
} finally {
  process.stdout.write = originalWrite;
}

const logged = captured.join('');
for (const forbidden of ['TOKEN_MUST_NOT_BE_LOGGED', 'COOKIE_MUST_NOT_BE_LOGGED', 'PERSONAL_DATA_MUST_NOT_BE_LOGGED', 'QUERY_VALUE_MUST_NOT_BE_LOGGED', 'SQL_MUST_NOT_BE_LOGGED']) {
  assert.doesNotMatch(logged, new RegExp(forbidden));
}

const summary = await service.summary();
assert.equal(summary.metrics.length, 256);
assert.equal(summary.droppedMetricSeries, 1);
assert.ok(summary.metrics.every((metric) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(metric.method)));
assert.ok(summary.metrics.every((metric) => ['2xx', '3xx', '4xx', '5xx'].includes(metric.statusClass)));

const interceptorSource = readFileSync(fileURLToPath(new URL('./request-observability.interceptor.js', import.meta.url)), 'utf8');
assert.match(interceptorSource, /const route = request\.routeOptions\?\.url;/);
assert.doesNotMatch(interceptorSource, /const route = request\.url;/);

console.log('observability privacy policy verification passed');
