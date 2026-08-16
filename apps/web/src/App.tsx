import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CommandCenterSalesCalendar } from './command-center-sales-calendar';
import { BaseerBrand } from './baseer-brand';
import { CompanySessionControl } from './company-session-control';
import { DailySalesWorkspace } from './daily-sales-workspace';
import { AdministrationWorkspace } from './administration-workspace';
import { PurchaseExpenseWorkspace } from './purchase-expense-workspace';
const FinanceSetupWorkspace = lazy(async () => ({ default: (await import('./finance-setup-workspace')).FinanceSetupWorkspace }));
import { getModule, modules, type ModuleId } from './modules';

type Language = 'ar' | 'en';
type Theme = 'green' | 'blue' | 'plum' | 'classic';
type ResolvedRoute = { moduleId: ModuleId; section: number };

type Route = ResolvedRoute | null;

const recentStorageKey = 'baseer-erp.shell.recent.v1';
const themeStorageKey = 'baseer-erp.shell.theme.v1';

const copy = {
  ar: {
    choose: 'ماذا تريد أن تنجز؟',
    chooseDescription: 'اختر الموديول. بعد ذلك ستجد كل أقسامه في قائمته الجانبية.',
    search: 'ابحث عن موديول…',
    noResults: 'لا توجد نتيجة مطابقة.',
    recent: 'الأخيرة',
    permission: 'تظهر الموديولات وفق الصلاحيات.',
    central: 'نظام واحد · شركة واحدة · بيانات مركزية',
    currentModule: 'الموديول الحالي',
    allModules: 'كل الموديولات',
    sections: 'الأقسام',
    thisMonth: 'هذا الشهر',
    quickEntry: 'إدخال سريع',
    company: 'شركة نوركس الافتراضية',
    greenTheme: 'الثيم الأخضر',
    blueTheme: 'الثيم الأزرق',
    plumTheme: 'الثيم البنفسجي',
    classicTheme: 'الثيم الكلاسيكي',
    foundation: 'نواة واجهة فقط:',
    foundationText: 'كل رقم أو عملية أو فلتر سيأتي لاحقًا من العقد الخادمي الرسمي لهذا القسم، لا من الواجهة.',
    heroText: 'تنتقل بين أقسام هذا الموديول من القائمة الجانبية فقط.',
    openModules: 'فتح الموديولات',
  },
  en: {
    choose: 'What do you want to do?',
    chooseDescription: 'Choose a module. Its sections will then be available in its sidebar.',
    search: 'Search a module…',
    noResults: 'No matching result.',
    recent: 'Recent',
    permission: 'Modules are shown according to permissions.',
    central: 'One system · one company · centralized data',
    currentModule: 'Current module',
    allModules: 'All modules',
    sections: 'Sections',
    thisMonth: 'This month',
    quickEntry: 'Quick entry',
    company: 'Noorix Default Company',
    greenTheme: 'Green theme',
    blueTheme: 'Blue theme',
    plumTheme: 'Plum theme',
    classicTheme: 'Classic theme',
    foundation: 'Interface foundation only:',
    foundationText: 'Every number, action, and filter will later come from this section’s official server contract, never from the interface.',
    heroText: 'Navigate this module’s sections only from its sidebar.',
    openModules: 'Open modules',
  },
} as const;

const themeLabels: Record<Language, Record<Theme, string>> = {
  ar: { green: "الأخضر", blue: "الأزرق", plum: "البنفسجي", classic: "الكلاسيكي" },
  en: { green: "Green", blue: "Blue", plum: "Plum", classic: "Classic" },
};
function ThemePicker({ language, theme, onTheme }: { language: Language; theme: Theme; onTheme: (theme: Theme) => void }) {
  return <label className="theme-button"><span className="theme-dot" /><select value={theme} onChange={(event) => onTheme(event.target.value as Theme)} aria-label={language === "ar" ? "اختيار الثيم" : "Choose theme"}>{(["green", "blue", "plum", "classic"] as const).map((item) => <option key={item} value={item}>{themeLabels[language][item]}</option>)}</select></label>;
}

function parseRoute(): Route {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const moduleId = params.get('module');
  const section = Number(params.get('section'));
  const module = modules.find((item) => item.id === moduleId);
  if (!module || !Number.isInteger(section) || section < 0 || section >= module.sections.ar.length) return null;
  return { moduleId: module.id, section };
}

function readRecent(): ResolvedRoute[] {
  try {
    const raw = localStorage.getItem(recentStorageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): ResolvedRoute[] => {
      if (typeof value !== 'string') return [];
      const [moduleId, sectionValue] = value.split(':');
      const module = modules.find((item) => item.id === moduleId);
      const section = Number(sectionValue);
      return module && Number.isInteger(section) && section >= 0 && section < module.sections.ar.length
        ? [{ moduleId: module.id, section }]
        : [];
    });
  } catch {
    return [];
  }
}

function persistRecent(route: ResolvedRoute): void {
  const key = `${route.moduleId}:${route.section}`;
  const values = readRecent().map((item) => `${item.moduleId}:${item.section}`).filter((item) => item !== key);
  localStorage.setItem(recentStorageKey, JSON.stringify([key, ...values].slice(0, 4)));
}

function AppHeader({ language, theme, onLanguage, onTheme, onModules }: { language: Language; theme: Theme; onLanguage: () => void; onTheme: (theme: Theme) => void; onModules: () => void }) {
  const text = copy[language];
  return <header className="topbar">
    <button className="icon-button app-modules-button" onClick={onModules} type="button" aria-label={text.allModules}>{"\u283f"}</button>
    <div className="topbar-spacer" />
    <CompanySessionControl language={language} />
    <button className="text-button" onClick={onLanguage} type="button">{language === 'ar' ? 'EN' : 'ع'}</button>
    <ThemePicker language={language} theme={theme} onTheme={onTheme} />
    <button className="avatar" type="button" aria-label="Profile">م</button>
  </header>;
}

function ModuleLauncher({ language, theme, onLanguage, onTheme, onOpen }: { language: Language; theme: Theme; onLanguage: () => void; onTheme: (theme: Theme) => void; onOpen: (route: ResolvedRoute) => void }) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<ResolvedRoute[]>(readRecent);
  const text = copy[language];
  const visible = useMemo(() => modules.filter((module) => `${module.title.ar} ${module.title.en} ${module.description.ar} ${module.description.en}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())), [query]);
  const open = (route: ResolvedRoute) => { onOpen(route); setRecent(readRecent()); };
  return <div className="launcher-page">
    <header className="launcher-topbar"><button className="launcher-brand-anchor sidebar-brand brand-button" type="button"><BaseerBrand /></button><div className="topbar-spacer" /><button className="text-button" onClick={onLanguage} type="button">{language === 'ar' ? 'EN' : 'ع'}</button><ThemePicker language={language} theme={theme} onTheme={onTheme} /><button className="avatar" type="button" aria-label="Profile">م</button></header>
    <main className="launcher-page__content">
      <div className="launcher-page__heading"><p className="launcher-kicker">Baseer ERP</p><h1>{text.choose}</h1><p>{text.chooseDescription}</p></div>
      <div className="launcher-page__tools"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder={text.search} /></label><span className="module-count">{visible.length} / {modules.length}</span></div>
      {recent.length > 0 && <section className="recent"><h2>{text.recent}</h2><div className="recent__list">{recent.map((route) => { const module = getModule(route.moduleId); return <button key={`${route.moduleId}:${route.section}`} onClick={() => open(route)} type="button">{module.title[language]} · {module.sections[language][route.section]}</button>; })}</div></section>}
      <section className="modules-grid launcher-page__grid">{visible.map((module) => <button key={module.id} type="button" className="module-card" style={{ '--module': module.accent } as React.CSSProperties} onClick={() => open({ moduleId: module.id, section: 0 })}><span className="module-icon" aria-hidden="true">{module.icon}</span><span className="module-copy"><strong>{module.title[language]}</strong><span>{module.description[language]}</span></span><span className="module-arrow" aria-hidden="true">←</span></button>)}</section>
      {visible.length === 0 && <p className="empty-results">{text.noResults}</p>}
      <footer className="launcher-page__footer"><span>{text.permission}</span><span>{text.central}</span></footer>
    </main>
  </div>;
}

function Navigation({ moduleId, active, language, onSelect }: { moduleId: ModuleId; active: number; language: Language; onSelect: (section: number) => void }) {
  const module = getModule(moduleId);
  return <nav className="module-navigation">{module.sections[language].map((label, index) => <button key={label} type="button" onClick={() => onSelect(index)} className={`nav-item${index === active ? " active" : ""}`}><span className="nav-dot" /><span>{label}</span></button>)}</nav>;
}
function ModuleWorkspace({ route, language, theme, onLanguage, onTheme, onModules, onSection }: { route: ResolvedRoute; language: Language; theme: Theme; onLanguage: () => void; onTheme: (theme: Theme) => void; onModules: () => void; onSection: (section: number) => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const module = getModule(route.moduleId);
  const text = copy[language];
  const sectionTitle = module.sections[language][route.section];
  const select = (section: number) => { onSection(section); setDrawerOpen(false); };
  return <>
    <AppHeader language={language} theme={theme} onLanguage={onLanguage} onTheme={onTheme} onModules={onModules} />
    <main className="workspace">
      <aside className="module-sidebar"><div className="sidebar-product"><button className="sidebar-brand brand-button" onClick={onModules} type="button"><BaseerBrand /></button></div><div className="sidebar-head"><p className="overline">{text.currentModule}</p><h2>{module.title[language]}</h2></div><Navigation moduleId={module.id} active={route.section} language={language} onSelect={select} /></aside>
      <section className="module-page"><div className="page-breadcrumb">Baseer ERP / {module.title[language]}</div><div className="page-heading"><div><h1>{sectionTitle}</h1></div><div className="page-actions"><button className="mobile-sections" type="button" onClick={() => setDrawerOpen(true)}>☰ {text.sections}</button><button className="period-button" type="button">◫ {text.thisMonth}</button></div></div>{route.moduleId === 'operations' && route.section === 1 ? <DailySalesWorkspace language={language} /> : route.moduleId === 'operations' && route.section === 2 ? <PurchaseExpenseWorkspace language={language} /> : route.moduleId === 'finance' && route.section === 0 ? <Suspense fallback={<section className="module-page__placeholder">جارٍ تحميل إعدادات المالية…</section>}><FinanceSetupWorkspace language={language} /></Suspense> : route.moduleId === 'administration' ? <AdministrationWorkspace language={language} section={route.section} /> : route.moduleId === 'command' && route.section === 0 ? <CommandCenterSalesCalendar language={language} /> : <><section className="hero-panel"><div><span className="eyebrow">{module.title[language]}</span><h2>{language === 'ar' ? `مرحبًا بك في ${sectionTitle}` : `Welcome to ${sectionTitle}`}</h2><p>{text.heroText}</p></div><button className="hero-action" type="button" onClick={onModules}>{text.openModules} ←</button></section><section className="module-page__placeholder"><strong>{text.foundation}</strong> {text.foundationText}</section></>}</section>
    </main>
    {drawerOpen && <div className="mobile-drawer is-open"><div className="mobile-drawer__backdrop" onClick={() => setDrawerOpen(false)} /><aside className="mobile-drawer__panel" aria-label={text.sections}><header><div><p className="overline">{text.sections}</p><h2>{module.title[language]}</h2></div><button className="close-button" type="button" onClick={() => setDrawerOpen(false)} aria-label="Close">×</button></header><Navigation moduleId={module.id} active={route.section} language={language} onSelect={select} /></aside></div>}
  </>;
}

export function App() {
  const [language, setLanguage] = useState<Language>('ar');
  const [theme, setTheme] = useState<Theme>(() => { const stored = localStorage.getItem(themeStorageKey); return stored === 'blue' || stored === 'plum' || stored === 'classic' || stored === 'green' ? stored : 'green'; });
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'; }, [language]);
  useEffect(() => { document.body.classList.remove('is-classic', 'is-blue', 'is-plum'); if (theme !== 'green') document.body.classList.add(`is-${theme}`); localStorage.setItem(themeStorageKey, theme); }, [theme]);
  useEffect(() => { const listener = () => setRoute(parseRoute()); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  const open = (next: ResolvedRoute) => { persistRecent(next); window.location.hash = `module=${next.moduleId}&section=${next.section}`; setRoute(next); };
  const clear = () => { history.replaceState(null, '', window.location.pathname); setRoute(null); };
  const toggleLanguage = () => setLanguage((current) => current === 'ar' ? 'en' : 'ar');
  return route ? <ModuleWorkspace route={route} language={language} theme={theme} onLanguage={toggleLanguage} onTheme={setTheme} onModules={clear} onSection={(section) => open({ moduleId: route.moduleId, section })} /> : <ModuleLauncher language={language} theme={theme} onLanguage={toggleLanguage} onTheme={setTheme} onOpen={open} />;
}
