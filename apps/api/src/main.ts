import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ObservabilityService } from './observability/observability.service.js';
import { RequestObservabilityInterceptor } from './observability/request-observability.interceptor.js';
import { validatePrivateDeploymentConfiguration } from './operations/private-deployment-config.js';

async function bootstrap(): Promise<void> {
  validatePrivateDeploymentConfiguration();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  // The API does not serve the SPA. Keep CSP/HSTS deployment-controlled until
  // the TLS edge and SPA asset policy are verified; the remaining Helmet
  // headers are safe for JSON API responses in every environment.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    hsts: process.env.BASEER_ENABLE_HSTS === 'true',
  });
  app.setGlobalPrefix('v1');
  // Authenticated ERP receipts must always be read from the live company
  // projection. The client also requests no-store; this response policy keeps
  // intermediaries from retaining a stale financial workspace response.
  const fastify = app.getHttpAdapter().getInstance() as {
    addHook(name: 'onSend', handler: (request: { headers: Record<string, string | string[] | undefined> }, reply: { header(name: string, value: string): unknown }) => Promise<void>): void;
  };
  fastify.addHook('onSend', async (request, reply) => {
    if (request.headers.authorization) {
      reply.header('Cache-Control', 'no-store, private');
    }
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(app.get(RequestObservabilityInterceptor));
  app.enableShutdownHooks();
  const port = Number.parseInt(process.env.BASEER_API_PORT ?? '5200', 10);
  const host = process.env.BASEER_BIND_HOST ?? '127.0.0.1';
  await app.listen({ host, port });
  app.get(ObservabilityService).logLifecycle('service.started');
}

void bootstrap();
