/** Owner-confirmed supplier alias map for Noorix's old Diar Safwa source ID. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-diyar-safwa-supplier-alias/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_DIYAR_SAFWA_SUPPLIER_ALIAS_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const SOURCE_SUPPLIER_ID = 'cmnjfe52o005z13ina3f0tcpd';
const SOURCE_NAME = 'شركة ديار صفوى للتجارة';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) throw new Error(`Usage: node scripts/run-local-nurix-al-shami-diyar-safwa-supplier-alias-map.mjs <package> <tenant> <company> <owner> DRY_RUN|${APPROVAL}`);
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');
// Noorix retained this historical invoice supplier under an older company
// scope.  The source identity is therefore proven by its immutable ID, name
// and tax number, not by that stale scope.
const sourceSql = `SELECT json_build_object('id',s.id,'nameAr',s.name_ar,'taxNumber',coalesce(s.tax_number,''))::text FROM suppliers s WHERE s.id='${SOURCE_SUPPLIER_ID}';`;
const source = JSON.parse(execFileSync('docker', ['exec','nurix-rehearsal-20260827','psql','-U','nurix_restore','-d','nurix_rehearsal','-t','-A','-c',sourceSql], { encoding: 'utf8' }).trim() || '{}');
if (source.id !== SOURCE_SUPPLIER_ID || source.nameAr !== SOURCE_NAME || !source.taxNumber) throw new Error('The frozen Noorix supplier evidence differs.');
const checksum = sha(source);
process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
let app;
try {
 app = await NestFactory.createApplicationContext(AppModule, { logger: ['error','warn'] });
 const database = app.get(DatabaseService);
 const inspect = async (tx) => {
  const [pkg, supplier, prior] = await Promise.all([
   tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId,tenantId,targetCompanyId:companyId,sourceCompanyId:SOURCE_COMPANY_ID,status:'READY_FOR_RECONCILIATION' }, select:{id:true} }),
   tx.financeSupplier.findMany({ where: { tenantId,companyId,nameAr:SOURCE_NAME,status:'ACTIVE' }, select:{id:true,nameAr:true,taxNumber:true} }),
   tx.nurixExcelFinancialSourceMap.findMany({ where:{tenantId,targetCompanyId:companyId,sourceEntity:'Supplier',sourceId:SOURCE_SUPPLIER_ID,targetEntity:'FinanceSupplier'},select:{targetId:true,sourceChecksum:true,state:true} }),
  ]);
  if (!pkg || supplier.length !== 1) throw new Error('The approved package or unique active target supplier is unavailable.');
  if (prior.length > 1 || prior.length === 1 && (prior[0].targetId !== supplier[0].id || prior[0].sourceChecksum !== checksum || prior[0].state !== 'APPLIED')) throw new Error('A conflicting Diar Safwa supplier map already exists.');
  return { supplier: supplier[0], prior: prior[0] ?? null };
 };
 const preview = await database.inTenantTransaction(tenantId,inspect);
 const planSha = sha({version:VERSION,source,target:preview.supplier.id});
 console.log(JSON.stringify({status:'PARSED_DRY_RUN',version:VERSION,planSha,sourceSupplier:source,targetSupplier:preview.supplier,action:preview.prior?'REUSED':'MAP_CONFIRMED_ALIAS',financialWrites:0},null,2));
 if (mode === 'DRY_RUN') process.exitCode=0;
 else {
  const receipt = await database.inTenantTransaction(tenantId,async(tx)=>{
   const current=await inspect(tx); const existing=await tx.nurixExcelFinancialExecution.findUnique({where:{packageId_tenantId_transformVersion:{packageId,tenantId,transformVersion:VERSION}},select:{id:true,financialPlanSha256:true}});
   const execution=existing ? (existing.financialPlanSha256===planSha?existing: (()=>{throw new Error('Existing supplier-alias execution differs.');})()) : await tx.nurixExcelFinancialExecution.create({data:{id:randomUUID(),packageId,tenantId,targetCompanyId:companyId,transformVersion:VERSION,financialPlanSha256:planSha,status:'COMPLETED',reason:'Owner-confirmed unique Diar Safwa supplier alias; source tax number retained as evidence.',requestedByUserId:actorUserId,approvedByUserId:actorUserId,approvedAt:new Date()},select:{id:true,financialPlanSha256:true}});
   if (!current.prior) await tx.nurixExcelFinancialSourceMap.create({data:{id:randomUUID(),executionId:execution.id,tenantId,targetCompanyId:companyId,sourceEntity:'Supplier',sourceId:SOURCE_SUPPLIER_ID,sourceChecksum:checksum,targetEntity:'FinanceSupplier',targetId:current.supplier.id,state:'APPLIED'}});
   await tx.auditEvent.create({data:{id:randomUUID(),tenantId,companyId,actorUserId,action:'nurix.al_shami.diyar_safwa_supplier_alias.applied',entityType:'FinanceSupplier',entityId:current.supplier.id,requestId:`nurix-al-shami-diyar-alias:${planSha}`,afterJson:{source,sourceChecksum:checksum,ownerConfirmation:true}}});
   return {sourceSupplierId:SOURCE_SUPPLIER_ID,targetSupplierId:current.supplier.id,reused:Boolean(current.prior)};
  });
  console.log(JSON.stringify({status:'COMPLETED',version:VERSION,planSha,receipt},null,2));
 }
} finally { await app?.close(); }
