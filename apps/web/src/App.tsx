import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BaseerBrand } from './baseer-brand';
import { BaseerLogin } from './baseer-login';
import { BaseerModuleIcon } from './baseer-module-icon';
import { CompanySessionControl } from './company-session-control';
const AdministrationWorkspace = lazy(async () => ({ default: (await import('./administration-workspace')).AdministrationWorkspace }));
const CommandCenterSalesCalendar = lazy(async () => ({ default: (await import('./command-center-sales-calendar')).CommandCenterSalesCalendar }));
const DailySalesWorkspace = lazy(async () => ({ default: (await import('./daily-sales-workspace')).DailySalesWorkspace }));
const PurchaseExpenseWorkspace = lazy(async () => ({ default: (await import('./purchase-expense-workspace')).PurchaseExpenseWorkspace }));
const ExpensesObligationsWorkspace = lazy(async () => ({ default: (await import('./expenses-obligations-workspace')).ExpensesObligationsWorkspace }));
const FinanceSetupWorkspace = lazy(async () => ({ default: (await import('./finance-setup-workspace')).FinanceSetupWorkspace }));
const InvoiceRegisterWorkspace = lazy(async () => ({ default: (await import('./invoice-register-workspace')).InvoiceRegisterWorkspace }));
const TreasuryWorkspace = lazy(async () => ({ default: (await import('./treasury-workspace')).TreasuryWorkspace }));
const CategoriesWorkspace = lazy(async () => ({ default: (await import('./categories-workspace')).CategoriesWorkspace }));
import { getModule, modules, type ModuleId } from './modules';
import { activeSession, clearActiveSession, listAvailableCompanies, signOutActiveSession } from './daily-sales-client';
import { canOpenRoute, firstAllowedRoute, visibleModules, visibleSections } from './module-access';
import { appText } from './app-copy';

type Language = 'ar' | 'en';
type Theme = 'green' | 'blue' | 'plum' | 'classic';
type ResolvedRoute = { moduleId: ModuleId; section: number };

type Route = ResolvedRoute | null;

const recentStorageKey = 'baseer-erp.shell.recent.v1';
const themeStorageKey = 'baseer-erp.shell.theme.v1';
const languageStorageKey = 'baseer.ui.locale.v1';



function ThemePicker({ language, theme, onTheme }: { language: Language; theme: Theme; onTheme: (theme: Theme) => void }) {
  const text = appText(language);
  const colors: Record<Theme, string> = { green: "#087f54", blue: "#1268a7", plum: "#7650a7", classic: "#9a7139" };
  return <details className="theme-button"><summary aria-label={text.themePicker}><span className="theme-dot" style={{ width: "20px", height: "20px", background: colors[theme] }} /></summary><div style={{ position: "absolute", zIndex: 30, top: "calc(100% + 8px)", insetInlineEnd: 0, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", padding: "10px", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "var(--surface)", boxShadow: "0 12px 28px rgb(10 45 31 / 16%)" }}>{(["green", "blue", "plum", "classic"] as const).map((item) => <button key={item} type="button" aria-label={item} onClick={(event) => { onTheme(item); event.currentTarget.closest("details")?.removeAttribute("open"); }} style={{ width: "30px", height: "30px", padding: 0, border: theme === item ? "2px solid var(--ink)" : "1px solid var(--line)", borderRadius: "999px", background: colors[item], cursor: "pointer" }} />)}</div></details>;
}
function readLanguagePreference(): Language {
  try {
    const stored = localStorage.getItem(languageStorageKey);
    return stored === 'ar' || stored === 'en' ? stored : 'ar';
  } catch {
    return 'ar';
  }
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

function AppHeader({ language, theme, onLanguage, onTheme, onModules, onSignOut }: { language: Language; theme: Theme; onLanguage: () => void; onTheme: (theme: Theme) => void; onModules: () => void; onSignOut: () => void }) {
  const text = appText(language);
  return <header className="topbar">
    <button className="icon-button app-modules-button" onClick={onModules} type="button" aria-label={text.allModules}>{"\u283f"}</button>
    <div className="topbar-spacer" />
    <CompanySessionControl language={language} />
    <button className="text-button" onClick={onLanguage} type="button">{language === 'ar' ? text.switchToEnglish : text.switchToArabic}</button>
    <ThemePicker language={language} theme={theme} onTheme={onTheme} />
    <button className="text-button" onClick={onSignOut} type="button">{language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}</button>
  </header>;
}

function ModuleLauncher({ language, theme, onLanguage, onTheme, onOpen, onSignOut, permissionCodes }: { language: Language; theme: Theme; onLanguage: () => void; onTheme: (theme: Theme) => void; onOpen: (route: ResolvedRoute) => void; onSignOut: () => void; permissionCodes: readonly string[] | null }) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<ResolvedRoute[]>(readRecent);
  const text = appText(language);
  const visible = useMemo(() => visibleModules(permissionCodes).filter((module) => `${module.title.ar} ${module.title.en}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())), [permissionCodes, query]);
  const open = (route: ResolvedRoute) => { if (!canOpenRoute(route, permissionCodes)) return; onOpen(route); setRecent(readRecent()); };
  return <div className="launcher-page">
    <header className="launcher-topbar"><button className="launcher-brand-anchor sidebar-brand brand-button" type="button"><BaseerBrand /></button><div className="topbar-spacer" /><button className="text-button" onClick={onLanguage} type="button">{language === 'ar' ? text.switchToEnglish : text.switchToArabic}</button><ThemePicker language={language} theme={theme} onTheme={onTheme} /><button className="text-button" onClick={onSignOut} type="button">{language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}</button></header>
    <main className="launcher-page__content">
      <div className="launcher-page__heading"><p className="launcher-kicker">Baseer ERP</p><h1>{text.choose}</h1></div>
      <div className="launcher-page__tools"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder={text.search} /></label><span className="module-count">{visible.length} / {modules.length}</span></div>
      {recent.filter((route) => canOpenRoute(route, permissionCodes)).length > 0 && <section className="recent"><h2>{text.recent}</h2><div className="recent__list">{recent.filter((route) => canOpenRoute(route, permissionCodes)).map((route) => { const module = getModule(route.moduleId); return <button key={`${route.moduleId}:${route.section}`} onClick={() => open(route)} type="button">{module.title[language]} · {module.sections[language][route.section]}</button>; })}</div></section>}
      <section className="modules-grid launcher-page__grid">{visible.map((module) => <button key={module.id} type="button" className="module-card" style={{ '--module': module.accent, '--module-alt': module.accentAlt } as React.CSSProperties} onClick={() => { const route = firstAllowedRoute(module.id, permissionCodes); if (route) open(route); }}><span className="module-icon" aria-hidden="true"><BaseerModuleIcon moduleId={module.id} /></span><span className="module-copy"><strong>{module.title[language]}</strong></span><span className="module-arrow" aria-hidden="true">←</span></button>)}</section>
      {visible.length === 0 && <p className="empty-results">{text.noResults}</p>}

    </main>
  </div>;
}

function Navigation({ moduleId, active, language, onSelect, permissionCodes }: { moduleId: ModuleId; active: number; language: Language; onSelect: (section: number) => void; permissionCodes: readonly string[] | null }) {
  const module = getModule(moduleId);
  const sections = visibleSections(moduleId, permissionCodes);
  return <nav className="module-navigation">{sections.map((index) => {
    const label = module.sections[language][index];
    return <button key={label} type="button" onClick={() => onSelect(index)} className={"nav-item" + (index === active ? " active" : "")}><span className="nav-dot" /><span>{label}</span></button>;
  })}</nav>;
}
function ModuleWorkspace({ route, language, theme, onLanguage, onTheme, onModules, onSection, onSignOut, permissionCodes }: { route: ResolvedRoute; language: Language; theme: Theme; onLanguage: () => void; onTheme: (theme: Theme) => void; onModules: () => void; onSection: (section: number) => void; onSignOut: () => void; permissionCodes: readonly string[] | null }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);
  const module = getModule(route.moduleId);
  const text = appText(language);
  const sectionTitle = module.sections[language][route.section];
  const select = (section: number) => { onSection(section); setDrawerOpen(false); };
  return <>
    <AppHeader language={language} theme={theme} onLanguage={onLanguage} onTheme={onTheme} onModules={onModules} onSignOut={onSignOut} />
    <main className="workspace">
      <aside className="module-sidebar"><div className="sidebar-product"><button className="sidebar-brand brand-button" onClick={onModules} type="button"><BaseerBrand /></button></div><div className="sidebar-head"><p className="overline">{text.currentModule}</p><h2>{module.title[language]}</h2></div><Navigation moduleId={module.id} active={route.section} language={language} onSelect={select} permissionCodes={permissionCodes} /></aside>
      <section className="module-page"><div className="page-breadcrumb">Baseer ERP / {module.title[language]}</div><div className="page-heading"><div><h1>{sectionTitle}</h1></div><div className="page-actions"><button className="mobile-sections" type="button" onClick={() => setDrawerOpen(true)}>☰ {text.sections}</button></div></div>{route.moduleId === 'operations' && route.section === 1 ? <Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><DailySalesWorkspace language={language} /></Suspense> : route.moduleId === 'operations' && route.section === 2 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingPurchases}</section>}><PurchaseExpenseWorkspace language={language} /></Suspense> : route.moduleId === 'finance' && route.section === 0 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><FinanceSetupWorkspace language={language} /></Suspense> : route.moduleId === 'finance' && route.section === 1 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><InvoiceRegisterWorkspace language={language} /></Suspense> : route.moduleId === 'finance' && route.section === 2 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingVaults}</section>}><TreasuryWorkspace language={language} /></Suspense> : route.moduleId === 'finance' && route.section === 4 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><CategoriesWorkspace language={language} /></Suspense> : route.moduleId === 'operations' && route.section === 3 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingExpensesObligations}</section>}><ExpensesObligationsWorkspace language={language} /></Suspense> : route.moduleId === 'operations' && route.section === 4 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><FinanceSetupWorkspace language={language} view="suppliers" /></Suspense> : route.moduleId === 'administration' ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingAdministration}</section>}><AdministrationWorkspace language={language} section={route.section} /></Suspense> : route.moduleId === 'command' && route.section === 0 ? <Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><CommandCenterSalesCalendar language={language} /></Suspense> : <><section className="hero-panel"><div><span className="eyebrow">{module.title[language]}</span><h2>{language === 'ar' ? `مرحبًا بك في ${sectionTitle}` : `Welcome to ${sectionTitle}`}</h2></div></section><section className="module-page__placeholder" /></>}</section>
    </main>
    {drawerOpen && <div className="mobile-drawer is-open"><div className="mobile-drawer__backdrop" onClick={() => setDrawerOpen(false)} /><aside className="mobile-drawer__panel" aria-label={text.sections}><header><div><p className="overline">{text.sections}</p><h2>{module.title[language]}</h2></div><button className="close-button" type="button" onClick={() => setDrawerOpen(false)} aria-label={text.close}>×</button></header><Navigation moduleId={module.id} active={route.section} language={language} onSelect={select} permissionCodes={permissionCodes} /></aside></div>}
  </>;
}

export function App() {
  const [language, setLanguage] = useState<Language>(readLanguagePreference);
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(themeStorageKey);
    return stored === "blue" || stored === "plum" || stored === "classic" || stored === "green" ? stored : "green";
  });
  const [route, setRoute] = useState<Route>(parseRoute);
  const [permissionCodes, setPermissionCodes] = useState<string[] | null>(null);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    localStorage.setItem(languageStorageKey, language);
  }, [language]);
  useEffect(() => {
    document.body.classList.remove("is-classic", "is-blue", "is-plum");
    if (theme !== "green") document.body.classList.add("is-" + theme);
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);
  useEffect(() => {
    const listener = () => setRoute(parseRoute());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    const session = activeSession();
    if (!session) { setPermissionCodes(null); return; }
    let cancelled = false;
    void listAvailableCompanies(session).then((companies) => {
      const active = companies.find((company) => company.id === session.companyId);
      if (!cancelled) setPermissionCodes(active?.permissionCodes ?? []);
    }).catch(() => { if (!cancelled) setPermissionCodes([]); });
    return () => { cancelled = true; };
  }, [route?.moduleId, route?.section]);

  const open = (next: ResolvedRoute) => {
    persistRecent(next);
    window.location.hash = "module=" + next.moduleId + "&section=" + next.section;
    setRoute(next);
  };
  const clear = () => {
    history.replaceState(null, "", window.location.pathname);
    setRoute(null);
  };
  const toggleLanguage = () => setLanguage((current) => current === "ar" ? "en" : "ar");
  const signOut = () => {
    const session = activeSession();
    clearActiveSession();
    const reload = () => window.location.reload();
    if (!session) { reload(); return; }
    void signOutActiveSession(session.accessToken).catch(() => undefined).finally(reload);
  };

  useEffect(() => {
    if (!route || permissionCodes === null || canOpenRoute(route, permissionCodes)) return;
    const replacement = firstAllowedRoute(route.moduleId, permissionCodes)
      ?? visibleModules(permissionCodes).flatMap((module) => {
        const next = firstAllowedRoute(module.id, permissionCodes);
        return next ? [next] : [];
      })[0];
    if (replacement) open(replacement); else clear();
  }, [permissionCodes, route]);

  if (!activeSession()) {
    return <BaseerLogin language={language} onLanguage={toggleLanguage} themeControl={<ThemePicker language={language} theme={theme} onTheme={setTheme} />} />;
  }
  return route
    ? <ModuleWorkspace route={route} language={language} theme={theme} onLanguage={toggleLanguage} onTheme={setTheme} onModules={clear} onSection={(section) => open({ moduleId: route.moduleId, section })} onSignOut={signOut} permissionCodes={permissionCodes} />
    : <ModuleLauncher language={language} theme={theme} onLanguage={toggleLanguage} onTheme={setTheme} onOpen={open} onSignOut={signOut} permissionCodes={permissionCodes} />;
}
