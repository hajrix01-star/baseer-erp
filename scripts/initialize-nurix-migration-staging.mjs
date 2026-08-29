import { URL } from 'node:url';

import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { FinanceFoundationService } from '../apps/api/dist/finance/finance-foundation.service.js';

const tenantId = requireUuid(process.env.BASEER_MIGRATION_TENANT_ID, 'BASEER_MIGRATION_TENANT_ID');
const actorUserId = requireUuid(process.env.BASEER_MIGRATION_ACTOR_ID, 'BASEER_MIGRATION_ACTOR_ID');
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/baseer_migration_staging') {
  throw new Error('This initializer may run only against local baseer_migration_staging on 127.0.0.1:5433.');
}

const database = new DatabaseService();
const foundation = new FinanceFoundationService(database);

try {
  const companies = await database.inTenantTransaction(tenantId, async (transaction) => {
    const run = await transaction.legacyMigrationRun.findFirst({
      where: {
        tenantId,
        sourceSystem: 'NOORIX_POSTGRES_ARCHIVE',
        sourceFingerprint: 'D8836B78AB52B8C297D87115767314E0560A2C09993000C0C503E5BA27C7B9AD',
        transformVersion: 'nurix-finance-dry-run/v1',
        status: 'DISCOVERY',
      },
      select: { id: true },
    });
    if (!run) throw new Error('The expected Noorix discovery run is unavailable or no longer in DISCOVERY.');
    return transaction.legacyMigrationCompanyMap.findMany({
      where: { runId: run.id, tenantId, state: 'PLANNED', targetCompany: { status: 'ARCHIVED' } },
      select: { targetCompanyId: true },
      orderBy: { createdAt: 'asc' },
    });
  });
  if (companies.length !== 8) throw new Error('Expected exactly eight planned, archived target companies.');

  let initialized = 0;
  for (const company of companies) {
    const result = await foundation.initializeForCompany({ tenantId, companyId: company.targetCompanyId, actorUserId, requestId: `nurix-staging-foundation:${company.targetCompanyId}` });
    if (result.initialized) initialized += 1;
  }
  console.log(`Noorix migration staging finance foundation completed for ${companies.length} archived companies; newly initialized=${initialized}.`);
} finally {
  await database.onModuleDestroy();
}

function requireUuid(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return value;
}
