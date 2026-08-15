import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { catchError, finalize, throwError } from 'rxjs';

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

    return new Observable((subscriber) => RequestContext.run({ correlationId }, () => next.handle().pipe(
      catchError((error: unknown) => throwError(() => error)),
      finalize(() => {
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
