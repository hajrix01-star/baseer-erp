import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { DatabaseService } from './database/database.service.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ObservabilityService } from './observability/observability.service.js';
import { RequestObservabilityInterceptor } from './observability/request-observability.interceptor.js';
import { validatePrivateDeploymentConfiguration } from './operations/private-deployment-config.js';
import { loadCanonicalLocalEnvironment } from './local-environment.js';

function trustedReverseProxyAddresses(): string[] | false {
  if (process.env.NODE_ENV !== 'production') return false;
  return (process.env.BASEER_TRUSTED_REVERSE_PROXY_IPS ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}

async function bootstrap(): Promise<void> {
  loadCanonicalLocalEnvironment();
  validatePrivateDeploymentConfiguration();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: trustedReverseProxyAddresses() }),
  );
  const corsOrigins = (process.env.BASEER_CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Browser access is opt-in. A private deployment normally serves its SPA
  // behind the same TLS edge, but a local review workspace can explicitly
  // allow its own Vite origin without widening the API to arbitrary sites.
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins });
  }
  // The API does not serve the SPA. Report CSP violations without blocking a
  // response while the TLS edge and SPA asset policy are verified. HSTS stays
  // deployment-controlled because it is only safe after TLS is confirmed.
  await app.register(helmet, {
    contentSecurityPolicy: {
      reportOnly: true,
      directives: {
        baseUri: ["'none'"],
        defaultSrc: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
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
  // Do not accept browser traffic while the API has not proved it can reach
  // its source of truth. This avoids a cold-start window where the first
  // workspace read fails even though the process is already listening.
  const database = app.get(DatabaseService);
  await database.client.$connect();
  await database.client.$queryRaw`SELECT 1`;
  const port = Number.parseInt(process.env.BASEER_API_PORT ?? '5200', 10);
  const host = process.env.BASEER_BIND_HOST ?? '127.0.0.1';
  await app.listen({ host, port });
  app.get(ObservabilityService).logLifecycle('service.started');
}

void bootstrap();
