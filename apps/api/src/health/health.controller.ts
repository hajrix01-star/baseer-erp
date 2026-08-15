import { healthReceiptSchema, type HealthReceipt } from '@baseer-erp/contracts';
import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ObservabilityService } from '../observability/observability.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly observability: ObservabilityService) {}

  @Get()
  getHealth(): HealthReceipt {
    return healthReceiptSchema.parse({ status: 'ok', service: 'baseer-erp-api' });
  }

  @Get('ready')
  @HttpCode(200)
  async getReadiness(@Res({ passthrough: true }) response: FastifyReply): Promise<HealthReceipt> {
    const readiness = await this.observability.readiness();
    if (readiness === 'not_ready') response.code(503);
    return healthReceiptSchema.parse({ status: readiness, service: 'baseer-erp-api' });
  }
}