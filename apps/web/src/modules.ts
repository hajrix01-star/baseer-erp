export type ModuleId = 'command' | 'decision' | 'marketing' | 'inbound-evidence' | 'operations' | 'finance' | 'hr' | 'reports' | 'administration';

export type ModuleDefinition = {
  id: ModuleId;
  accent: string;
  accentAlt: string;
  title: { ar: string; en: string };
  launcherTitle?: { ar: string; en: string };
};

export const modules: readonly ModuleDefinition[] = [
  { id: 'command', accent: 'var(--brand)', accentAlt: 'var(--chart-primary-soft)', title: { ar: 'مركز القيادة', en: 'Command center' } },
  { id: 'decision', accent: 'var(--status-info)', accentAlt: 'var(--chart-info)', title: { ar: 'مركز القرار والسياق', en: 'Decision & context center' }, launcherTitle: { ar: 'مركز القرار', en: 'Decision center' } },
  { id: 'marketing', accent: 'var(--chart-secondary)', accentAlt: 'var(--status-warning)', title: { ar: 'الأداء التسويقي والسمعة', en: 'Marketing performance & reputation' }, launcherTitle: { ar: 'التسويق والسمعة', en: 'Marketing & reputation' } },
  { id: 'inbound-evidence', accent: 'var(--chart-info)', accentAlt: 'var(--status-info)', title: { ar: 'البريد والأدلة', en: 'Mail & evidence' } },
  { id: 'operations', accent: 'var(--status-info)', accentAlt: 'var(--chart-primary-soft)', title: { ar: 'العمليات', en: 'Operations' } },
  { id: 'finance', accent: 'var(--chart-secondary)', accentAlt: 'var(--chart-primary)', title: { ar: 'المالية والمحاسبة', en: 'Finance & accounting' }, launcherTitle: { ar: 'المالية', en: 'Finance' } },
  { id: 'hr', accent: 'var(--status-danger)', accentAlt: 'var(--chart-secondary)', title: { ar: 'الموارد البشرية', en: 'Human resources' } },
  { id: 'reports', accent: 'var(--chart-info)', accentAlt: 'var(--chart-primary)', title: { ar: 'التقارير', en: 'Reports' } },
  { id: 'administration', accent: 'var(--muted)', accentAlt: 'var(--status-warning)', title: { ar: 'الإدارة', en: 'Administration' } },
];

export const getModule = (id: ModuleId): ModuleDefinition => modules.find((item) => item.id === id) ?? modules[0];
