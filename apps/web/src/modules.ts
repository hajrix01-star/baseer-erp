export type ModuleId = 'command' | 'decision' | 'marketing' | 'inbound-evidence' | 'operations' | 'finance' | 'hr' | 'reports' | 'administration';

export type ModuleDefinition = {
  id: ModuleId;
  accent: string;
  accentAlt: string;
  title: { ar: string; en: string };
};

export const modules: readonly ModuleDefinition[] = [
  { id: 'command', accent: '#08744d', accentAlt: '#35c69a', title: { ar: 'مركز القيادة', en: 'Command center' } },
  { id: 'decision', accent: '#3d6f8e', accentAlt: '#64b8c8', title: { ar: 'مركز القرار والسياق', en: 'Decision & context center' } },
  { id: 'marketing', accent: '#a35b2e', accentAlt: '#e6a64f', title: { ar: 'الأداء التسويقي والسمعة', en: 'Marketing performance & reputation' } },
  { id: 'inbound-evidence', accent: '#526d87', accentAlt: '#7fc3c8', title: { ar: 'البريد والأدلة', en: 'Mail & evidence' } },
  { id: 'operations', accent: '#176e9e', accentAlt: '#36b8ed', title: { ar: 'العمليات', en: 'Operations' } },
  { id: 'finance', accent: '#a3532e', accentAlt: '#ec8851', title: { ar: 'المالية والمحاسبة', en: 'Finance & accounting' } },
  { id: 'hr', accent: '#a84c84', accentAlt: '#f0a33c', title: { ar: 'الموارد البشرية', en: 'Human resources' } },
  { id: 'reports', accent: '#7554aa', accentAlt: '#38b9d5', title: { ar: 'التقارير', en: 'Reports' } },
  { id: 'administration', accent: '#536b63', accentAlt: '#f0b54e', title: { ar: 'الإدارة', en: 'Administration' } },
];

export const getModule = (id: ModuleId): ModuleDefinition => modules.find((item) => item.id === id) ?? modules[0];
