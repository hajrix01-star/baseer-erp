import type {
  OutputActor,
  OutputArtifact,
  OutputRequest,
  ReportDefinition,
  ReportSnapshot,
} from './contracts.js';
import { renderExcel } from './excel-renderer.js';
import { renderPrintPreviewDocument } from './print-preview.js';

export class OutputPlatform {
  private readonly definitions = new Map<string, ReportDefinition>();

  register(definition: ReportDefinition): void {
    if (this.definitions.has(definition.code)) {
      throw new Error(`Duplicate report definition: ${definition.code}`);
    }
    this.definitions.set(definition.code, definition);
  }

  async createSnapshot(actor: OutputActor, request: OutputRequest): Promise<ReportSnapshot> {
    const definition = this.definitions.get(request.reportCode);
    if (!definition) throw new Error('OUTPUT_REPORT_NOT_FOUND');
    if (request.scope.companyIds.length !== 1) throw new Error('OUTPUT_SINGLE_COMPANY_REQUIRED');
    if (request.idempotencyKey.length < 16) throw new Error('OUTPUT_IDEMPOTENCY_KEY_INVALID');

    const authorization = await definition.authorize(actor, request);
    if (!authorization.allowed) throw new Error(authorization.deniedCode ?? 'OUTPUT_FORBIDDEN');
    const snapshot = await definition.createSnapshot(actor, request);
    if (snapshot.reportCode !== definition.code) throw new Error('OUTPUT_SNAPSHOT_REPORT_MISMATCH');
    return snapshot;
  }

  async createArtifact(actor: OutputActor, request: OutputRequest): Promise<OutputArtifact | string> {
    const snapshot = await this.createSnapshot(actor, request);
    if (request.format === 'preview') return renderPrintPreviewDocument(snapshot);
    if (request.format === 'xlsx') return renderExcel(snapshot);
    throw new Error('OUTPUT_FORMAT_NOT_IMPLEMENTED');
  }
}
