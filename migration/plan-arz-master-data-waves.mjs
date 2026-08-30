import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node migration/plan-arz-master-data-waves.mjs <package.xlsx> <plan.json>');
const bytes = await readFile(resolve(input));
const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: false, cellDates: false, WTF: true });
const rows = (sheet) => XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: '', raw: false });
const accounts = rows('Accounts');
const employees = rows('Employees');
const categories = rows('Categories');
if (!accounts.length || !employees.length || !categories.length) throw new Error('Required master-data sheets are missing or empty.');

const byCode = new Map(categories.map((row) => [row.baseer_category_code, row]));
const pending = new Map(byCode);
const categoryWaves = [];
while (pending.size) {
  const ready = [...pending.values()].filter((row) => !row.parent_baseer_category_code || !pending.has(row.parent_baseer_category_code));
  if (!ready.length) throw new Error(`Category parent cycle or missing parent: ${[...pending.keys()].join(', ')}`);
  categoryWaves.push(ready.map((row) => row.baseer_category_code).sort());
  ready.forEach((row) => pending.delete(row.baseer_category_code));
}

const plan = {
  version: 'noorix-master-data-wave-plan/v1',
  sourceWorkbookSha256: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'),
  writeBoundary: 'PLAN_ONLY_NO_DATABASE_WRITES',
  waves: [
    { order: 1, entity: 'FinanceAccount', sourceSheet: 'Accounts', count: accounts.length, key: 'code + account_type', action: 'CREATE_OR_REUSE_EXACT' },
    ...categoryWaves.map((codes, index) => ({ order: index + 2, entity: 'FinanceCategory', sourceSheet: 'Categories', count: codes.length, key: 'baseer_category_code + category_type', parentDependency: index ? 'prior category wave' : 'none', action: 'CREATE_OR_REUSE_EXACT', sourceCodes: codes })),
    { order: categoryWaves.length + 2, entity: 'HrEmployee', sourceSheet: 'Employees', count: employees.length, key: 'employee_serial', action: 'CREATE_OR_REUSE_EXACT' },
    { order: categoryWaves.length + 3, entity: 'FinanceVault', sourceSheet: 'Vaults', action: 'REVIEW_REQUIRED', reason: 'A vault must be explicitly linked to a compatible account and payment method.' },
  ],
};
await writeFile(resolve(output), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ accountCount: accounts.length, categoryWaves: categoryWaves.map((wave) => wave.length), employeeCount: employees.length, financialWrites: 0 }, null, 2));
