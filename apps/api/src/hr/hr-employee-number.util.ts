import type { Prisma } from '../generated/prisma/client.js';

const DEFAULT_PREFIX = 'EMP';

/** Keeps employee identifiers readable and stable: EMP-001, EMP-002, … */
export async function generateHrEmployeeNumber(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
  const existing = await tx.hrEmployee.findMany({ where: { companyId, employeeNumber: { startsWith: `${DEFAULT_PREFIX}-` } }, select: { employeeNumber: true } });
  const nextSequence = existing.reduce((highest, employee) => {
    const sequence = employee.employeeNumber.match(/^EMP-(\d+)$/)?.[1];
    return sequence ? Math.max(highest, Number.parseInt(sequence, 10)) : highest;
  }, 0) + 1;
  return `${DEFAULT_PREFIX}-${String(nextSequence).padStart(3, '0')}`;
}
