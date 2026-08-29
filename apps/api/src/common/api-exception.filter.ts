import type { ApiErrorReceipt } from '@baseer-erp/contracts';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { IdempotencyPayloadMismatchError } from '../core-controls/idempotency.service.js';
import { RequestContext } from '../observability/request-context.js';
import { ReportRunExpiredException } from '../reports/report-run.service.js';
import { AUTH_THROTTLE_WINDOW_MS } from '../identity/auth-throttle-policy.js';

type ErrorCode = ApiErrorReceipt['error']['code'];
type Retry = ApiErrorReceipt['error']['retry'];

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const idempotencyMismatch = exception instanceof IdempotencyPayloadMismatchError;
    const reportRunExpired = exception instanceof ReportRunExpiredException;
    const status = idempotencyMismatch
      ? HttpStatus.CONFLICT
      : exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const correlationId = RequestContext.correlationId()
      ?? RequestContext.resolveCorrelationId(request.headers['x-request-id']);
    const retryAfterSeconds = status === HttpStatus.TOO_MANY_REQUESTS
      ? this.retryAfterSeconds(response)
      : undefined;
    const [code, retry] = this.classify(status, retryAfterSeconds, idempotencyMismatch, reportRunExpired);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Keep the response safe, but preserve a correlation-bound diagnosis in
      // the server log. Without this, an interceptor can record its pre-filter
      // status and turn a real 500 into an opaque client-side failure.
      const summary = exception instanceof Error ? `${exception.name}: ${exception.message}` : "Unknown exception";
      this.logger.error(`${request.method} ${request.url} failed [${correlationId}] ${summary}`);
    }

    const receipt: ApiErrorReceipt = {
      error: {
        code,
        message: this.messageFor(code),
        correlationId,
        retry,
      },
    };

    if (retryAfterSeconds) response.header('retry-after', retryAfterSeconds);
    response.header('x-request-id', correlationId).status(status).send(receipt);
  }

  private classify(
    status: number,
    retryAfterSeconds?: number,
    idempotencyMismatch = false,
    reportRunExpired = false,
  ): [ErrorCode, Retry] {
    if (idempotencyMismatch) return ['IDEMPOTENCY_MISMATCH', { kind: 'do-not-retry' }];
    if (reportRunExpired) return ['REPORT_RUN_EXPIRED', { kind: 'do-not-retry' }];
    if (status === HttpStatus.BAD_REQUEST) return ['VALIDATION_FAILED', { kind: 'do-not-retry' }];
    if (status === HttpStatus.UNAUTHORIZED) return ['AUTHENTICATION_FAILED', { kind: 'do-not-retry' }];
    if (status === HttpStatus.FORBIDDEN) return ['AUTHORIZATION_DENIED', { kind: 'do-not-retry' }];
    if (status === HttpStatus.NOT_FOUND) return ['NOT_FOUND', { kind: 'do-not-retry' }];
    if (status === HttpStatus.CONFLICT) return ['CONFLICT', { kind: 'do-not-retry' }];
    if (status === HttpStatus.TOO_MANY_REQUESTS)
      return retryAfterSeconds
        ? ['RATE_LIMITED', { kind: 'retry-after', retryAfterSeconds }]
        : ['RATE_LIMITED', { kind: 'retry' }];
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return ['DEPENDENCY_UNAVAILABLE', { kind: 'retry' }];
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) return ['INTERNAL_ERROR', { kind: 'retry' }];

    return ['VALIDATION_FAILED', { kind: 'do-not-retry' }];
  }

  private retryAfterSeconds(response: FastifyReply): number | undefined {
    for (const header of [
      'retry-after-authIp',
      'retry-after-authIdentity',
      'retry-after-report',
      'retry-after-output',
      'retry-after-fileWrite',
      'retry-after-attendancePin',
    ]) {
      const value = response.getHeader(header);
      const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;
      // @nestjs/throttler exposes the remaining block time in milliseconds;
      // the HTTP Retry-After header and API contract use whole seconds.
      if (Number.isFinite(parsed) && parsed > 0) {
        const seconds = Math.ceil(parsed / 1_000);
        // Throttler can expose the final limiter TTL (occasionally 1 second)
        // instead of its active block duration. Never tell a person to retry
        // before the configured authentication lock can have expired.
        if (header === 'retry-after-authIp' || header === 'retry-after-authIdentity') {
          return Math.max(seconds, Math.ceil(AUTH_THROTTLE_WINDOW_MS / 1_000));
        }
        return seconds;
      }
    }
    // A custom 429 must not masquerade as the fifteen-minute authentication
    // lock. Named limiters supply their authoritative duration above.
    return undefined;
  }

  private messageFor(code: ErrorCode): ApiErrorReceipt['error']['message'] {
    const messages: Record<ErrorCode, ApiErrorReceipt['error']['message']> = {
      AUTHENTICATION_FAILED: { ar: 'تعذر التحقق من بيانات الدخول.', en: 'Authentication failed.' },
      AUTHORIZATION_DENIED: { ar: 'ليس لديك إذن لهذا الإجراء.', en: 'You are not allowed to perform this action.' },
      CONFLICT: { ar: 'يتعارض الطلب مع الحالة الحالية.', en: 'The request conflicts with the current state.' },
      DEPENDENCY_UNAVAILABLE: { ar: 'الخدمة المطلوبة غير متاحة مؤقتًا.', en: 'A required service is temporarily unavailable.' },
      IDEMPOTENCY_MISMATCH: { ar: 'مفتاح الإعادة لا يطابق الطلب الأصلي.', en: 'The idempotency key does not match the original request.' },
      INTERNAL_ERROR: { ar: 'حدث خطأ داخلي آمن.', en: 'A safe internal error occurred.' },
      NOT_FOUND: { ar: 'السجل المطلوب غير موجود.', en: 'The requested resource was not found.' },
      REPORT_RUN_EXPIRED: { ar: 'انتهت صلاحية لقطة التقرير. حدّث التقرير ثم أعد المحاولة.', en: 'The report snapshot has expired. Refresh the report and try again.' },
      RATE_LIMITED: { ar: '\u062a\u0645 \u062a\u0642\u064a\u064a\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0627\u062a \u0645\u0624\u0642\u062a\u0627\u064b. \u0623\u0639\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0644\u0627\u062d\u0642\u0627\u064b.', en: 'Requests are temporarily limited. Try again later.' },
      VALIDATION_FAILED: { ar: 'بيانات الطلب غير صالحة.', en: 'The request data is invalid.' },
    };

    return messages[code];
  }
}
