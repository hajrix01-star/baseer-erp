import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { acknowledgeNurixMigrationExceptionRequestSchema, approveNurixCompanyMapsRequestSchema, approveNurixDirectCandidatesRequestSchema, createCommercialNurixMigrationCounterpartyRequestSchema, createNurixProvisionalSuppliersRequestSchema, nurixMigrationCounterpartyQueueQuerySchema, nurixMigrationCounterpartyQueueReceiptSchema, nurixMigrationCounterpartyReviewGroupReceiptSchema, nurixMigrationCounterpartySuggestionsReceiptSchema, nurixMigrationReviewReceiptSchema, nurixMigrationRunIdSchema, nurixMigrationRunListReceiptSchema, nurixProvisionalSuppliersReceiptSchema, resolveNurixMigrationCounterpartyRequestSchema } from '@baseer-erp/contracts';
import { TenantAdministrationContextService } from '../administration/tenant-administration-context.service.js';
import { NurixMigrationReviewService } from './nurix-migration-review.service.js';

@Controller('nurix-migration')
export class NurixMigrationReviewController {
  constructor(private readonly context: TenantAdministrationContextService, private readonly reviews: NurixMigrationReviewService) {}

  @Get('runs')
  async list(@Headers('authorization') authorization?: string) {
    return nurixMigrationRunListReceiptSchema.parse(await this.reviews.listRuns(await this.context.authorizeOwner(this.accessToken(authorization))));
  }

  @Get('runs/:runId/review')
  async review(@Param('runId') runId: string, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    if (!id.success) throw new BadRequestException('Invalid Noorix migration run identifier.');
    return nurixMigrationReviewReceiptSchema.parse(await this.reviews.review(await this.context.authorizeOwner(this.accessToken(authorization)), id.data));
  }

  @Get('runs/:runId/counterparties')
  async counterparties(@Param('runId') runId: string, @Query() query: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const parsed = nurixMigrationCounterpartyQueueQuerySchema.safeParse(query);
    if (!id.success || !parsed.success) throw new BadRequestException('Invalid Noorix counterparty queue request.');
    return nurixMigrationCounterpartyQueueReceiptSchema.parse(await this.reviews.listCounterpartyCandidates(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, parsed.data.cursor, parsed.data.kind));
  }

  @Get('runs/:runId/counterparty-review-groups')
  async counterpartyReviewGroups(@Param('runId') runId: string, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    if (!id.success) throw new BadRequestException('Invalid Noorix migration run identifier.');
    return nurixMigrationCounterpartyReviewGroupReceiptSchema.parse(await this.reviews.listCounterpartyReviewGroups(await this.context.authorizeOwner(this.accessToken(authorization)), id.data));
  }

  @Get('runs/:runId/counterparty-suggestions')
  async counterpartySuggestions(@Param('runId') runId: string, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    if (!id.success) throw new BadRequestException('Invalid Noorix migration run identifier.');
    return nurixMigrationCounterpartySuggestionsReceiptSchema.parse(await this.reviews.listCounterpartySuggestions(await this.context.authorizeOwner(this.accessToken(authorization)), id.data));
  }

  @Post('runs/:runId/counterparty-review-groups/:groupKey/resolve')
  @HttpCode(201)
  async resolveCounterpartyReviewGroup(@Param('runId') runId: string, @Param('groupKey') groupKey: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const request = resolveNurixMigrationCounterpartyRequestSchema.safeParse(body);
    if (!id.success || !/^[a-f0-9]{64}$/.test(groupKey) || !request.success) throw new BadRequestException('Invalid Noorix supplier review-group decision.');
    return this.reviews.resolveCounterpartyReviewGroup(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, groupKey, request.data);
  }

  @Post('runs/:runId/counterparty-review-groups/:groupKey/create-commercial-identity')
  @HttpCode(201)
  async createCommercialCounterpartyReviewGroup(@Param('runId') runId: string, @Param('groupKey') groupKey: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const request = createCommercialNurixMigrationCounterpartyRequestSchema.safeParse(body);
    if (!id.success || !/^[a-f0-9]{64}$/.test(groupKey) || !request.success) throw new BadRequestException('Invalid Noorix supplier review-group creation request.');
    return this.reviews.createCommercialCounterpartyReviewGroup(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, groupKey, request.data);
  }

  @Post('runs/:runId/counterparties/:candidateId/resolve')
  @HttpCode(201)
  async resolveCounterparty(@Param('runId') runId: string, @Param('candidateId') candidateId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const candidate = nurixMigrationRunIdSchema.safeParse(candidateId);
    const request = resolveNurixMigrationCounterpartyRequestSchema.safeParse(body);
    if (!id.success || !candidate.success || !request.success) throw new BadRequestException('Invalid Noorix supplier identity decision.');
    return this.reviews.resolveCounterpartyCandidate(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, candidate.data, request.data);
  }

  @Post('runs/:runId/counterparties/:candidateId/create-commercial-identity')
  @HttpCode(201)
  async createCommercialCounterparty(@Param('runId') runId: string, @Param('candidateId') candidateId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const candidate = nurixMigrationRunIdSchema.safeParse(candidateId);
    const request = createCommercialNurixMigrationCounterpartyRequestSchema.safeParse(body);
    if (!id.success || !candidate.success || !request.success) throw new BadRequestException('Invalid Noorix commercial supplier identity decision.');
    return this.reviews.createCommercialCounterpartyAndResolve(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, candidate.data, request.data);
  }

  @Post('runs/:runId/direct-candidates/approve')
  @HttpCode(201)
  async approveDirectCandidates(@Param('runId') runId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const request = approveNurixDirectCandidatesRequestSchema.safeParse(body);
    if (!id.success || !request.success) throw new BadRequestException('Invalid direct candidate approval request.');
    return this.reviews.approveDirectCandidates(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, request.data);
  }

  @Post('runs/:runId/company-maps/approve')
  @HttpCode(201)
  async approveCompanyMaps(@Param('runId') runId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const request = approveNurixCompanyMapsRequestSchema.safeParse(body);
    if (!id.success || !request.success) throw new BadRequestException('Invalid company-map approval request.');
    return this.reviews.approveCompanyMaps(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, request.data);
  }

  @Post('runs/:runId/provisional-suppliers')
  @HttpCode(201)
  async createProvisionalSuppliers(@Param('runId') runId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const request = createNurixProvisionalSuppliersRequestSchema.safeParse(body);
    if (!id.success || !request.success) throw new BadRequestException('Invalid provisional supplier creation request.');
    return nurixProvisionalSuppliersReceiptSchema.parse(await this.reviews.createProvisionalSuppliers(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, request.data));
  }

  @Post('runs/:runId/exceptions/:exceptionId/acknowledge')
  @HttpCode(201)
  async acknowledgeException(@Param('runId') runId: string, @Param('exceptionId') exceptionId: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    const id = nurixMigrationRunIdSchema.safeParse(runId);
    const exception = nurixMigrationRunIdSchema.safeParse(exceptionId);
    const request = acknowledgeNurixMigrationExceptionRequestSchema.safeParse(body);
    if (!id.success || !exception.success || !request.success) throw new BadRequestException('Invalid migration exception acknowledgement request.');
    return this.reviews.acknowledgeException(await this.context.authorizeOwner(this.accessToken(authorization)), id.data, exception.data, request.data);
  }

  private accessToken(value?: string): string {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
    if (!match?.[1]) throw new UnauthorizedException('Invalid authentication credentials.');
    return match[1];
  }
}
