import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const HrWorkspaceCore = lazy(() => import("./hr-workspace").then((module) => ({ default: module.HrWorkspaceCore })));
const HrPayrollWorkspace = lazy(() => import("./hr-payroll-workspace").then((module) => ({ default: module.HrPayrollWorkspace })));
const HrLeaveWorkspace = lazy(() => import("./hr-leave-workspace").then((module) => ({ default: module.HrLeaveWorkspace })));
const HrServicesWorkspace = lazy(() => import("./hr-services-workspace").then((module) => ({ default: module.HrServicesWorkspace })));
const HrSalaryToolsWorkspace = lazy(() => import("./hr-salary-tools-workspace").then((module) => ({ default: module.HrSalaryToolsWorkspace })));

export function HrWorkspaceRouter({ language, section }: { language: Language; section: number }) {
  const ar = language === "ar";
  const stage = new URLSearchParams(window.location.hash.slice(1)).get("stage");
  if (section === 2) return <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل الإجازات والعودة…" : "Loading leave & return…"}</BaseerCard>}><HrLeaveWorkspace language={language} stage={stage} /></Suspense>;
  if (section === 3) return <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل مسير الرواتب…" : "Loading payroll…"}</BaseerCard>}><HrPayrollWorkspace language={language} stage={stage} /></Suspense>;
  if (section === 5) return <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل خدمات الموظفين…" : "Loading employee services…"}</BaseerCard>}><HrServicesWorkspace language={language} stage={stage} /></Suspense>;
  if (section === 6) return <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل أدوات الراتب…" : "Loading salary tools…"}</BaseerCard>}><HrSalaryToolsWorkspace language={language} /></Suspense>;
  return <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل سجل الموارد البشرية…" : "Loading HR register…"}</BaseerCard>}><HrWorkspaceCore language={language} section={section} stage={stage} /></Suspense>;
}
