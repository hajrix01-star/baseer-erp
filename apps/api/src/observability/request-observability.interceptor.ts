import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { catchError, finalize, throwError } from 'rxjs';

import { IdempotencyPayloadMismatchError } from '../core-controls/idempotency.service.js';
import { ObservabilityService } from './observability.service.js';
import { RequestContext } from './request-context.js';

@Injectable()
export class RequestObservabilityInterceptor implements NestInterceptor {
  constructor(private readonly observability: ObservabilityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const response = http.getResponse<FastifyReply>();
    const correlationId = RequestContext.resolveCorrelationId(request.headers['x-request-id']);
    const route = request.routeOptions?.url;
    const startedAt = performance.now();
    response.header('x-request-id', correlationId);

    let errorRecorded = false;
    return new Observable((subscriber) => RequestContext.run({ correlationId }, () => next.handle().pipe(
      catchError((error: unknown) => {
        // Nest runs exception filters after an interceptor's finalize block.
        // Record the status that will actually be returned instead of the
        // response's pre-filter default (usually 200).
        errorRecorded = true;
        this.observability.recordRequest({
          method: request.method,
          route,
          statusCode: error instanceof IdempotencyPayloadMismatchError
            ? 409
            : error instanceof HttpException ? error.getStatus() : 500,
          elapsedMilliseconds: performance.now() - startedAt,
          correlationId,
        });
        return throwError(() => error);
      }),
      finalize(() => {
        if (errorRecorded) return;
        this.observability.recordRequest({
          method: request.method,
          route,
          statusCode: response.statusCode,
          elapsedMilliseconds: performance.now() - startedAt,
          correlationId,
        });
      }),
    ).subscribe(subscriber)));
  }
}
