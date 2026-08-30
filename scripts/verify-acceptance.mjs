import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const quick = process.argv.includes("--quick");

const foundation = [
  ["قاعدة الاختبار", ["run", "verify:local-database"]],
  ["سلامة سجل ترحيلات Prisma", ["run", "check:local-prisma-migration-history"]],
  ["حالة ترحيلات Prisma", ["run", "prisma:test:status"]],
  ["اختبارات الوحدة", ["run", "test:unit"]],
  ["بنية المشروع", ["run", "check:architecture"]],
  ["تسجيل وحدات Nest", ["run", "check:nest-registration"]],
  ["كتالوج الصلاحيات", ["run", "check:permissions"]],
  ["عزل بيانات المالية", ["run", "check:finance-rls"]],
  ["عزل بيانات الموارد البشرية", ["run", "check:hr-rls"]],
  ["عزل بيانات الإدارة", ["run", "check:administration-rls"]],
  ["عزل بيانات التقارير", ["run", "check:reports-rls"]],
  ["عزل بيانات الذكاء واتخاذ القرار", ["run", "check:decision-intelligence-rls"]],
  ["عزل بيانات التسويق", ["run", "check:marketing-gate-a1"]],
  ["عزل بيانات مركز القيادة", ["run", "check:command-center-rls"]],
  ["حدود المالية في الواجهة", ["run", "check:web-financial-boundaries"]],
  ["سياسة إدخال الأرقام", ["run", "check:web-numeric-policy"]],
  ["تعريب الواجهة", ["run", "check:web-localization"]],
  ["استمرارية الجلسة", ["run", "check:session-resilience"]],
];

const departmentJourneys = [
  ["حماية الدخول", ["run", "verify:auth-throttling"]],
  ["دورة حياة الجلسات وعزل المنصة", ["run", "verify:platform-foundation"]],
  ["خصائص قيود اليومية", ["run", "verify:journal-properties"]],
  ["المالية وقاعدة البيانات", ["run", "verify:finance-gate-b-db"]],
  ["سباق إقفال الفترة المالية", ["run", "verify:finance-period-race"]],
  ["حسابات المالية عبر API", ["run", "verify:finance-accounts-http"]],
  ["دورة الإدارة", ["run", "verify:administration-lifecycle"]],
  ["تهيئة الموارد البشرية", ["run", "verify:hr-onboarding"]],
  ["دورة حياة الموارد البشرية", ["run", "verify:hr-lifecycle"]],
  ["موارد بشرية عبر API", ["run", "verify:hr-http"]],
  ["مشتريات وعمليات", ["run", "verify:operations-purchase-cycle"]],
  ["الأصول والضمان", ["run", "verify:operations-assets-warranty"]],
  ["التقارير عبر API", ["run", "verify:reports-http"]],
  ["مركز القيادة عبر API", ["run", "verify:command-center-http"]],
  ["الذكاء واتخاذ القرار عبر API", ["run", "verify:decision-intelligence-http"]],
  ["بوابة التسويق", ["run", "verify:marketing-gate-a1"]],
  ["النسخ الاحتياطي والاستعادة", ["run", "verify:backup-gate-1-db"]],
  ["رحلات الواجهة والمتصفح", ["run", "test:e2e", "--workspace", "@baseer-erp/web"]],
];

const steps = quick ? foundation : [...foundation, ...departmentJourneys];
const results = [];

for (const [name, args] of steps) {
  const startedAt = Date.now();
  console.log(`\n▶ ${name}`);
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { stdio: "inherit", shell: false })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { stdio: "inherit", shell: process.platform === "win32" });
  const passed = result.status === 0 && !result.error;
  results.push({ name, passed, seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)) });
  if (result.error) console.error(result.error.message);
  console.log(`${passed ? "✓" : "✗"} ${name}`);
}

const failures = results.filter((result) => !result.passed);
const report = {
  mode: quick ? "quick" : "full",
  completedAt: new Date().toISOString(),
  passed: failures.length === 0,
  results,
};

mkdirSync("test-results", { recursive: true });
writeFileSync(join("test-results", "acceptance-summary.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log("\n════════════════════════════════════");
console.log(`النتيجة: ${failures.length === 0 ? "نجح الفحص" : `فشل ${failures.length} من ${results.length}`}`);
console.log("التقرير: test-results/acceptance-summary.json");

if (failures.length > 0) {
  console.log(`الأقسام التي تحتاج معالجة: ${failures.map((failure) => failure.name).join("، ")}`);
  process.exitCode = 1;
}
