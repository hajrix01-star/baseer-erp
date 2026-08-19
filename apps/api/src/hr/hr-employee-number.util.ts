import type { Prisma } from '../generated/prisma/client.js';

const DEFAULT_PREFIX = 'EMP';

/**
 * Keeps employee identifiers readable and stable: AC-ST-001, AC-ST-002, …
 * The company prefix follows the NOORIX convention; historic employee numbers
 * are never rewritten.
 */
export async function generateHrEmployeeNumber(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { nameAr: true, nameEn: true } });
  const rawPrefix = (company?.nameEn || company?.nameAr || '').replace(/\s+/g, '').slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = rawPrefix.length >= 2 ? rawPrefix : DEFAULT_PREFIX;
  const last = await tx.hrEmployee.findFirst({ where: { companyId }, orderBy: { createdAt: 'desc' }, select: { employeeNumber: true } });
  const priorSequence = last?.employeeNumber.match(/-(\d+)$/)?.[1];
  const sequence = priorSequence ? Number.parseInt(priorSequence, 10) + 1 : 1;
  return `${prefix}-ST-${String(sequence).padStart(3, '0')}`;
}
