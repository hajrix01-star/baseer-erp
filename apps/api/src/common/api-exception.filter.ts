import type { ApiErrorReceipt } from '@baseer-erp/contracts';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RequestContext } from '../observability/request-context.js';

type ErrorCode = ApiErrorReceipt['error']['code'];
type Retry = ApiErrorReceipt['error']['retry'];

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const correlationId = RequestContext.correlationId()
      ?? RequestContext.resolveCorrelationId(request.headers['x-request-id']);
    const [code, retry] = this.classify(status);

    const receipt: ApiErrorReceipt = {
      error: {
        code,
        message: this.messageFor(code),
        correlationId,
        retry,
      },
    };

    response.header('x-request-id', correlationId).status(status).send(receipt);
  }

  private classify(status: number): [ErrorCode, Retry] {
    if (status === HttpStatus.BAD_REQUEST) return ['VALIDATION_FAILED', { kind: 'do-not-retry' }];
    if (status === HttpStatus.UNAUTHORIZED) return ['AUTHENTICATION_FAILED', { kind: 'do-not-retry' }];
    if (status === HttpStatus.FORBIDDEN) return ['AUTHORIZATION_DENIED', { kind: 'do-not-retry' }];
    if (status === HttpStatus.NOT_FOUND) return ['NOT_FOUND', { kind: 'do-not-retry' }];
    if (status === HttpStatus.CONFLICT) return ['CONFLICT', { kind: 'do-not-retry' }];
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return ['DEPENDENCY_UNAVAILABLE', { kind: 'retry' }];
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) return ['INTERNAL_ERROR', { kind: 'retry' }];

    return ['VALIDATION_FAILED', { kind: 'do-not-retry' }];
  }

  private messageFor(code: ErrorCode): ApiErrorReceipt['error']['message'] {
    const messages: Record<ErrorCode, ApiErrorReceipt['error']['message']> = {
      AUTHENTICATION_FAILED: { ar: 'تعذر التحقق من بيانات الدخول.', en: 'Authentication failed.' },
      AUTHORIZATION_DENIED: { ar: 'ليس لديك إذن لهذا الإجراء.', en: 'You are not allowed to perform this action.' },
      CONFLICT: { ar: 'يتعارض الطلب مع الحالة الحالية.', en: 'The request conflicts with the current state.' },
      DEPENDENCY_UNAVAILABLE: { ar: 'الخدمة المطلوبة غير متاحة مؤقتًا.', en: 'A required service is temporarily unavailable.' },
      IDEMPOTENCY_MISMATCH: { ar: 'مفتاح الإعادة لا يطابق الطلب الأصلي.', en: 'The idempotency key does not match the original request.' },
      INTERNAL_ERROR: { ar: 'حدث خطأ داخلي آمن.', en: 'A safe internal error occurred.' },
      NOT_FOUND: { ar: 'المورد المطلوب غير موجود.', en: 'The requested resource was not found.' },
      VALIDATION_FAILED: { ar: 'بيانات الطلب غير صالحة.', en: 'The request data is invalid.' },
    };

    return messages[code];
  }
}