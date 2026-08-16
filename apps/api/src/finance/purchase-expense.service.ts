import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceAccountStatus, FinanceAccountType, FinanceCategoryStatus, FinanceOutflowDocumentKind, FinanceOutflowDocumentStatus, FinanceOutflowSettlementKind, FinanceSupplierDueStatus, FinanceSupplierStatus, Prisma } from '../generated/prisma/client.js';
import { BusinessDateService } from '../business-date/business-date.service.js';
import { JournalPostingService } from './journal/journal-posting.service.js';
import { FinanceVaultService } from './finance-vault.service.js';

const OP = 'finance.purchase_expense.create';
export type PurchaseExpenseRequest = Readonly<{kind:'PURCHASE'|'EXPENSE';settlementKind:'PAID'|'PAYABLE';categoryId:string;supplierId?:string|undefined;supplierInvoiceNumber?:string|undefined;supplierInvoiceMissingReason?:string|undefined;businessDate:Date;supplierInvoiceDate?:Date|undefined;grossAmount:string;isTaxable:boolean;allocations:readonly Readonly<{vaultId:string;grossAmount:string}>[];notes?:string}>;
export type PurchaseExpenseReceipt = Readonly<{documentId:string;documentNumber:string;journalEntryId:string;kind:FinanceOutflowDocumentKind;settlementKind:FinanceOutflowSettlementKind;status:FinanceOutflowDocumentStatus;grossAmount:string;netAmount:string;vatAmount:string;supplierDueId:string|null}>;

@Injectable()
export class PurchaseExpenseService {
  constructor(private readonly db:DatabaseService,private readonly idem:IdempotencyService,private readonly serials:DocumentSerialService,private readonly journals:JournalPostingService,private readonly vaults:FinanceVaultService,private readonly dates:BusinessDateService){}
  async create(input:{context:TrustedCompanyActorContext;idempotencyKey:string;request:PurchaseExpenseRequest}):Promise<PurchaseExpenseReceipt>{
    return this.db.inTenantTransaction(input.context.tenantId,async tx=>{
      const r=this.normalise(input.request); const begun=await this.idem.beginInTransaction(tx,input.context,{operation:OP,key:input.idempotencyKey,request:this.payload(r),expiresAt:new Date(Date.now()+86400000)});
      if(begun.kind==='replay') return begun.response.body as unknown as PurchaseExpenseReceipt;
      if(begun.kind==='in-progress') throw new ConflictException('This purchase request is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx,input.context,r.businessDate);
      const category=await tx.financeCategory.findFirst({where:{id:r.categoryId,tenantId:input.context.tenantId,companyId:input.context.companyId,status:FinanceCategoryStatus.ACTIVE,isPosting:true,kind:r.kind},include:{account:{select:{id:true,type:true,status:true}}}});
      if(!category?.account||category.account.status!==FinanceAccountStatus.ACTIVE||category.account.type!==FinanceAccountType.ASSET&&category.account.type!==FinanceAccountType.EXPENSE)throw new BadRequestException('The selected category is not ready for financial posting.');
      if(r.supplierId&&!await tx.financeSupplier.findFirst({where:{id:r.supplierId,tenantId:input.context.tenantId,companyId:input.context.companyId,status:FinanceSupplierStatus.ACTIVE},select:{id:true}}))throw new BadRequestException('The selected supplier is not active.');
      if(r.settlementKind==='PAYABLE'&&!r.supplierId)throw new BadRequestException('A supplier is required for a payable document.');
      if(r.settlementKind==='PAID'&&!r.allocations.length)throw new BadRequestException('Choose at least one payment destination.');
      const gross=new Prisma.Decimal(r.grossAmount); if(!gross.isFinite()||gross.lte(0))throw new BadRequestException('The gross amount is invalid.');
      const profile=await tx.companyFinanceProfile.findFirst({where:{tenantId:input.context.tenantId,companyId:input.context.companyId},select:{vatAccountingEnabled:true,vatRateBasisPoints:true}}); const rate=r.isTaxable&&profile?.vatAccountingEnabled?profile.vatRateBasisPoints:0; const net=rate?gross.mul(10000).div(10000+rate).toDecimalPlaces(4,Prisma.Decimal.ROUND_HALF_UP):gross; const vat=gross.minus(net).toDecimalPlaces(4,Prisma.Decimal.ROUND_HALF_UP);
      const day=r.businessDate.toISOString().slice(0,10) as `${number}-${number}-${number}`; const seq=await this.serials.reserveInTransaction(tx,input.context,{series:r.kind==='PURCHASE'?'PURCHASE':'EXPENSE',businessDate:day}); const documentNumber=`${r.kind==='PURCHASE'?'PUR':'EXP'}-${day.replaceAll('-','')}-${seq.toString().padStart(4,'0')}`;
      const lines:{accountId:string;debitAmount?:string;creditAmount?:string;description?:string}[]=[{accountId:category.account.id,debitAmount:net.toFixed(4),description:documentNumber}]; if(!vat.isZero())lines.push({accountId:await this.account(tx,input.context,'VAT_INPUT'),debitAmount:vat.toFixed(4),description:documentNumber});
      let allocations:{vaultId:string;grossAmount:string}[]=[];let supplierDueId:string|null=null;
      if(r.settlementKind==='PAID'){const grouped=new Map<string,Prisma.Decimal>();for(const a of r.allocations)grouped.set(a.vaultId,(grouped.get(a.vaultId)??new Prisma.Decimal(0)).plus(a.grossAmount));const total=[...grouped.values()].reduce((s,v)=>s.plus(v),new Prisma.Decimal(0));if(!total.equals(gross))throw new BadRequestException('Payment allocations must equal the gross amount.');allocations=[...grouped.entries()].map(([vaultId,value])=>({vaultId,grossAmount:value.toFixed(4)}));for(const a of allocations){const vault=await this.vaults.assertActivePaymentDestination(tx,{...input.context,vaultId:a.vaultId});lines.push({accountId:vault.accountId,creditAmount:a.grossAmount,description:documentNumber});}}else{lines.push({accountId:await this.account(tx,input.context,'SUPPLIER_DUES'),creditAmount:gross.toFixed(4),description:documentNumber});supplierDueId=randomUUID();}
      const journal=await this.journals.postInTransaction(tx,{...input.context,requestId:`purchase-expense:${input.idempotencyKey}`,sourceType:'finance_outflow_document',sourceReference:documentNumber,businessDate:r.businessDate,description:r.notes??documentNumber,lines}); const documentId=randomUUID();
      await tx.financeOutflowDocument.create({data:{id:documentId,tenantId:input.context.tenantId,companyId:input.context.companyId,kind:r.kind,settlementKind:r.settlementKind,documentNumber,supplierId:r.supplierId??null,categoryId:r.categoryId,supplierInvoiceNumber:r.supplierInvoiceNumber??null,supplierInvoiceNumberNormalized:r.supplierInvoiceNumber?.toLocaleUpperCase('en-US')??null,supplierInvoiceMissingReason:r.supplierInvoiceMissingReason??null,businessDate:r.businessDate,supplierInvoiceDate:r.supplierInvoiceDate??null,grossAmount:gross,netAmount:net,vatAmount:vat,vatRateBasisPoints:rate,notes:r.notes??null,journalEntryId:journal.journalEntryId,createdByUserId:input.context.actorUserId}});
      if(allocations.length)await tx.financeOutflowAllocation.createMany({data:allocations.map(a=>({id:randomUUID(),tenantId:input.context.tenantId,companyId:input.context.companyId,documentId,vaultId:a.vaultId,grossAmount:a.grossAmount}))});
      if(supplierDueId)await tx.financeSupplierDue.create({data:{id:supplierDueId,tenantId:input.context.tenantId,companyId:input.context.companyId,supplierId:r.supplierId!,categoryId:r.categoryId,sourceDocumentNumber:documentNumber,originalBusinessDate:r.businessDate,originalAmount:gross,remainingAmount:gross,status:FinanceSupplierDueStatus.OPEN,notes:r.notes??null,journalEntryId:journal.journalEntryId}});
      const receipt:PurchaseExpenseReceipt={documentId,documentNumber,journalEntryId:journal.journalEntryId,kind:r.kind,settlementKind:r.settlementKind,status:FinanceOutflowDocumentStatus.POSTED,grossAmount:gross.toFixed(4),netAmount:net.toFixed(4),vatAmount:vat.toFixed(4),supplierDueId}; await tx.auditEvent.create({data:{id:randomUUID(),tenantId:input.context.tenantId,companyId:input.context.companyId,actorUserId:input.context.actorUserId,action:'finance.purchase_expense.created',entityType:'FinanceOutflowDocument',entityId:documentId,requestId:`purchase-expense:${input.idempotencyKey}`,afterJson:receipt as Prisma.InputJsonValue}}); await this.idem.completeInTransaction(tx,input.context,{receiptId:begun.receiptId,response:{status:201,headers:null,body:receipt}});return receipt;
    }).catch(e=>{if(e instanceof IdempotencyPayloadMismatchError)throw new ConflictException('The idempotency key was used with a different request.');throw e;});
  }
  async list(context: TrustedCompanyActorContext) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) =>
      tx.financeOutflowDocument.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
        take: 250,
        select: {
          id: true, documentNumber: true, kind: true, settlementKind: true,
          status: true, businessDate: true, grossAmount: true,
          supplier: { select: { nameAr: true } },
          category: { select: { nameAr: true } },
        },
      }).then((documents) => documents.map((document) => ({
        id: document.id, documentNumber: document.documentNumber,
        kind: document.kind, settlementKind: document.settlementKind,
        status: document.status, businessDate: document.businessDate,
        grossAmount: document.grossAmount.toFixed(4),
        supplierNameAr: document.supplier?.nameAr ?? null,
        categoryNameAr: document.category.nameAr,
      }))),
    );
  }  private async account(tx:Prisma.TransactionClient,c:TrustedCompanyActorContext,key:string){const r=await tx.financeAccount.findFirst({where:{tenantId:c.tenantId,companyId:c.companyId,systemKey:key,status:FinanceAccountStatus.ACTIVE},select:{id:true}});if(!r)throw new BadRequestException('The company financial setup is incomplete.');return r.id;}
  private normalise(r:PurchaseExpenseRequest):PurchaseExpenseRequest{const invoice=r.supplierInvoiceNumber?.trim();const missing=r.supplierInvoiceMissingReason?.trim();if(!invoice&&!missing)throw new BadRequestException('Provide the supplier invoice number or a missing reason.');if(invoice&&missing)throw new BadRequestException('Provide an invoice number or a missing reason, not both.');return {...r,...(invoice?{supplierInvoiceNumber:invoice}:{}),...(missing?{supplierInvoiceMissingReason:missing}:{}),...(r.notes?.trim()?{notes:r.notes.trim()}:{} )};}
  private payload(r:PurchaseExpenseRequest){return {kind:r.kind,settlementKind:r.settlementKind,categoryId:r.categoryId,supplierId:r.supplierId??null,supplierInvoiceNumber:r.supplierInvoiceNumber??null,supplierInvoiceMissingReason:r.supplierInvoiceMissingReason??null,businessDate:r.businessDate.toISOString(),supplierInvoiceDate:r.supplierInvoiceDate?.toISOString()??null,grossAmount:r.grossAmount,isTaxable:r.isTaxable,allocations:r.allocations.map(a=>({vaultId:a.vaultId,grossAmount:a.grossAmount})),notes:r.notes??null}as const;}
}