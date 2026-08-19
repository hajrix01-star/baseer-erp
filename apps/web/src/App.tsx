import { lazy, Suspense, useEffect, useState } from 'react';
import { BaseerBrand } from './baseer-brand';
import { BaseerLogin } from './baseer-login';
import { BaseerModuleIcon } from './baseer-module-icon';
import { BaseerSectionIcon } from './baseer-section-icon';
import { CompanySessionControl } from './company-session-control';
const AdministrationWorkspace = lazy(async () => ({ default: (await import('./administration-workspace')).AdministrationWorkspace }));
const CommandCenterSalesCalendar = lazy(async () => ({ default: (await import('./command-center-sales-calendar')).CommandCenterSalesCalendar }));
const DailySalesWorkspace = lazy(async () => ({ default: (await import('./daily-sales-workspace')).DailySalesWorkspace }));
const PurchaseExpenseWorkspace = lazy(async () => ({ default: (await import('./purchase-expense-workspace')).PurchaseExpenseWorkspace }));
const ExpensesObligationsWorkspace = lazy(async () => ({ default: (await import('./expenses-obligations-workspace')).ExpensesObligationsWorkspace }));
const FinanceSetupWorkspace = lazy(async () => ({ default: (await import('./finance-setup-workspace')).FinanceSetupWorkspace }));
const InvoiceRegisterWorkspace = lazy(async () => ({ default: (await import('./invoice-register-workspace')).InvoiceRegisterWorkspace }));
const TreasuryWorkspace = lazy(async () => ({ default: (await import('./treasury-workspace')).TreasuryWorkspace }));
const FinanceAccountsWorkspace = lazy(async () => ({ default: (await import('./finance-accounts-workspace')).FinanceAccountsWorkspace }));
const CategoriesWorkspace = lazy(async () => ({ default: (await import('./categories-workspace')).CategoriesWorkspace }));
const HrOverviewWorkspace = lazy(async () => ({ default: (await import('./hr-overview-workspace')).HrOverviewWorkspace }));
const HrWorkspace = lazy(async () => ({ default: (await import('./hr-workspace-router')).HrWorkspaceRouter }));
import { getModule, modules, type ModuleId } from './modules';
import { activeSession, clearActiveSession, listAvailableCompanies, signOutActiveSession } from './daily-sales-client';
import { canOpenRoute, firstAllowedRoute, visibleModules, visibleSections } from './module-access';
import { appText } from './app-copy';

type Language = 'ar' | 'en';
type Theme = 'green' | 'blue' | 'plum' | 'classic';
type LauncherBackground = 'emerald-light' | 'emerald-dark' | 'architectural-light' | 'desert-night' | 'saudi-heritage' | 'emerald-glass';
type ResolvedRoute = { moduleId: ModuleId; section: number; stage?: string };

type Route = ResolvedRoute | null;

const recentStorageKey = 'baseer-erp.shell.recent.v1';
const themeStorageKey = 'baseer-erp.shell.theme.v1';
const launcherBackgroundStorageKey = 'baseer-erp.shell.launcher-background.v1';
const languageStorageKey = 'baseer.ui.locale.v1';
const routeSessionKey = 'baseer.erp.shell.route.v1';



function ThemePicker({ language, theme, onTheme, background, onBackground }: { language: Language; theme: Theme; onTheme: (theme: Theme) => void; background?: LauncherBackground; onBackground?: (background: LauncherBackground) => void }) {
  const text = appText(language);
  const colors: Record<Theme, string> = { green: "#087f54", blue: "#1268a7", plum: "#7650a7", classic: "#9a7139" };
  const backgrounds: ReadonlyArray<{ id: LauncherBackground; ar: string; en: string }> = [{ id: 'emerald-light', ar: 'أخضر هادئ', en: 'Calm green' }, { id: 'emerald-dark', ar: 'أخضر داكن', en: 'Executive dark' }, { id: 'architectural-light', ar: 'معماري مضيء', en: 'Architectural light' }, { id: 'desert-night', ar: 'ليل تنفيذي', en: 'Executive night' }, { id: 'saudi-heritage', ar: 'تراث سعودي', en: 'Saudi heritage' }, { id: 'emerald-glass', ar: 'زجاج زمردي', en: 'Emerald glass' }];
  return <details className="theme-button"><summary aria-label={text.themePicker}><span className="theme-dot" style={{ width: "14px", height: "14px", background: colors[theme] }} /></summary><div className="theme-picker-menu"><div className="theme-color-grid">{(["green", "blue", "plum", "classic"] as const).map((item) => <button key={item} type="button" aria-label={item} onClick={(event) => { onTheme(item); event.currentTarget.closest("details")?.removeAttribute("open"); }} style={{ background: colors[item] }} className={theme === item ? 'is-selected' : ''} />)}</div>{background && onBackground ? <section className="launcher-background-picker"><p>{language === 'ar' ? 'خلفية شاشة التطبيقات' : 'App screen background'}</p>{backgrounds.map((item) => <button key={item.id} type="button" onClick={(event) => { onBackground(item.id); event.currentTarget.closest('details')?.removeAttribute('open'); }} className={background === item.id ? 'is-selected' : ''}><span className={`launcher-background-swatch launcher-background-swatch--${item.id}`} /><span>{language === 'ar' ? item.ar : item.en}</span><b>✓</b></button>)}</section> : null}</div></details>;
}

function playModulesRipple(button: HTMLButtonElement) {
  button.classList.remove('is-rippling');
  window.requestAnimationFrame(() => button.classList.add('is-rippling'));
}
function readLanguagePreference(): Language {
  try {
    const stored = localStorage.getItem(languageStorageKey);
    return stored === 'ar' || stored === 'en' ? stored : 'ar';
  } catch {
    return 'ar';
  }
}
function routeHash(route: ResolvedRoute): string {
  return `module=${route.moduleId}&section=${route.section}${route.stage ? `&stage=${encodeURIComponent(route.stage)}` : ''}`;
}
function persistRoute(route: ResolvedRoute): void {
  try { sessionStorage.setItem(routeSessionKey, routeHash(route)); } catch { /* session storage can be unavailable */ }
}
function parseRouteValue(value: string): Route {
  const params = new URLSearchParams(value.replace(/^#/, ''));
  const moduleId = params.get('module');
  const section = Number(params.get('section'));
  const stage = params.get('stage');
  const module = modules.find((item) => item.id === moduleId);
  if (!module || !Number.isInteger(section) || section < 0 || section >= module.sections.ar.length || (stage !== null && !/^[a-z][a-z0-9-]{0,31}$/.test(stage))) return null;
  return { moduleId: module.id, section, ...(stage ? { stage } : {}) };
}
function parseRoute(): Route {
  const fromHash = parseRouteValue(window.location.hash);
  if (fromHash) { persistRoute(fromHash); return fromHash; }
  if (window.location.hash) return null;
  try { return parseRouteValue(sessionStorage.getItem(routeSessionKey) ?? ''); } catch { return null; }
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

function SignOutIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="m14 8 4 4-4 4M18 12H8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function AppHeader({ language, theme, background, onLanguage, onTheme, onBackground, onModules, onSignOut }: { language: Language; theme: Theme; background: LauncherBackground; onLanguage: () => void; onTheme: (theme: Theme) => void; onBackground: (background: LauncherBackground) => void; onModules: () => void; onSignOut: () => void }) {
  const text = appText(language);
  return <header className="topbar">
    <button className="icon-button app-modules-button" onClick={onModules} onPointerDown={(event) => playModulesRipple(event.currentTarget)} onAnimationEnd={(event) => { if (event.animationName === 'app-modules-ripple') event.currentTarget.classList.remove('is-rippling'); }} type="button" aria-label={text.allModules}>{"\u283f"}</button>
    <div className="topbar-spacer" />
    <CompanySessionControl language={language} />
    <button className="text-button" onClick={onLanguage} type="button">{language === 'ar' ? text.switchToEnglish : text.switchToArabic}</button>
    <ThemePicker language={language} theme={theme} onTheme={onTheme} background={background} onBackground={onBackground} />
    <button className="header-signout" onClick={onSignOut} type="button" aria-label={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'} title={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}><SignOutIcon /></button>
  </header>;
}

function ModuleLauncher({ language, theme, background, onLanguage, onTheme, onBackground, onOpen, onSignOut, permissionCodes }: { language: Language; theme: Theme; background: LauncherBackground; onLanguage: () => void; onTheme: (theme: Theme) => void; onBackground: (background: LauncherBackground) => void; onOpen: (route: ResolvedRoute) => void; onSignOut: () => void; permissionCodes: readonly string[] | null }) {
  const [recent, setRecent] = useState<ResolvedRoute[]>(readRecent);
  const text = appText(language);
  const visible = visibleModules(permissionCodes);
  const open = (route: ResolvedRoute) => { if (!canOpenRoute(route, permissionCodes)) return; onOpen(route); setRecent(readRecent()); };
  return <div className="launcher-page">
    <header className="launcher-topbar"><button className="launcher-brand-anchor sidebar-brand brand-button" style={{ transform: "translateY(11px)" }} type="button"><BaseerBrand /></button><div className="topbar-spacer" /><CompanySessionControl language={language} /><button className="text-button" onClick={onLanguage} type="button">{language === 'ar' ? text.switchToEnglish : text.switchToArabic}</button><ThemePicker language={language} theme={theme} onTheme={onTheme} background={background} onBackground={onBackground} /><button className="header-signout" onClick={onSignOut} type="button" aria-label={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'} title={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}><SignOutIcon /></button></header>
    <main className="launcher-page__content">
      <div className="launcher-page__heading"><p className="launcher-kicker">Baseer ERP</p><h1>{text.choose}</h1></div>
      {recent.filter((route) => canOpenRoute(route, permissionCodes)).length > 0 && <section className="recent"><h2>{text.recent}</h2><div className="recent__list">{recent.filter((route) => canOpenRoute(route, permissionCodes)).map((route) => { const module = getModule(route.moduleId); return <button key={`${route.moduleId}:${route.section}`} onClick={() => open(route)} type="button">{module.title[language]} · {module.sections[language][route.section]}</button>; })}</div></section>}
      <section className="modules-grid launcher-page__grid">{visible.map((module) => <button key={module.id} type="button" className="module-card" style={{ '--module': module.accent, '--module-alt': module.accentAlt } as React.CSSProperties} onClick={() => { const route = firstAllowedRoute(module.id, permissionCodes); if (route) open(route); }}><span className="module-icon-panel" aria-hidden="true"><span className="module-icon"><BaseerModuleIcon moduleId={module.id} /></span></span><span className="module-copy"><strong>{module.title[language]}</strong></span></button>)}</section>
      {visible.length === 0 && <p className="empty-results">{text.noResults}</p>}

    </main>
  </div>;
}

function Navigation({ moduleId, active, language, onSelect, permissionCodes }: { moduleId: ModuleId; active: number; language: Language; onSelect: (section: number) => void; permissionCodes: readonly string[] | null }) {
  const module = getModule(moduleId);
  const sections = visibleSections(moduleId, permissionCodes);
  return <nav className="module-navigation">{sections.map((index) => {
    const label = module.sections[language][index];
    const colors = ['#36b37e', '#42a5f5', '#ff9f43', '#c77dff', '#f5bd1f', '#fb7185'];
    return <button key={label} type="button" onClick={() => onSelect(index)} className={"nav-item" + (index === active ? " active" : "")}><span className="nav-icon" style={{ '--section-accent': colors[index % colors.length] } as React.CSSProperties}><BaseerSectionIcon moduleId={moduleId} index={index} /></span><span>{label}</span></button>;
  })}</nav>;
}
function ModuleWorkspace({ route, language, theme, background, onLanguage, onTheme, onBackground, onModules, onSection, onStage, onSignOut, permissionCodes }: { route: ResolvedRoute; language: Language; theme: Theme; background: LauncherBackground; onLanguage: () => void; onTheme: (theme: Theme) => void; onBackground: (background: LauncherBackground) => void; onModules: () => void; onSection: (section: number) => void; onStage: (stage: string) => void; onSignOut: () => void; permissionCodes: readonly string[] | null }) {
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
    <AppHeader language={language} theme={theme} background={background} onLanguage={onLanguage} onTheme={onTheme} onBackground={onBackground} onModules={onModules} onSignOut={onSignOut} />
    <main className="workspace">
      <aside className="module-sidebar"><div className="sidebar-product"><button className="sidebar-brand brand-button" style={{ transform: "translateY(11px)" }} onClick={onModules} type="button"><BaseerBrand /></button></div><div className="sidebar-head"><p className="overline">{text.currentModule}</p><h2>{module.title[language]}</h2></div><Navigation moduleId={module.id} active={route.section} language={language} onSelect={select} permissionCodes={permissionCodes} /></aside>
      <section className={`module-page${route.moduleId === "hr" ? " module-page--hr" : ""}`}><div className="page-breadcrumb">Baseer ERP / {module.title[language]}</div><div className="page-heading"><div><h1>{sectionTitle}</h1></div><div className="page-actions"><button className="mobile-sections" type="button" onClick={() => setDrawerOpen(true)}>☰ {text.sections}</button></div></div>{route.moduleId === 'hr' && route.section === 0 ? <Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><HrOverviewWorkspace language={language} /></Suspense> : route.moduleId === 'hr' ? <Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><HrWorkspace language={language} section={route.section} /></Suspense> : route.moduleId === 'operations' && route.section === 1 ? <Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><DailySalesWorkspace language={language} /></Suspense> : route.moduleId === 'operations' && route.section === 2 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingPurchases}</section>}><PurchaseExpenseWorkspace language={language} activeTab={route.stage === "credit" ? "credit" : "entry"} onTabChange={onStage} /></Suspense> : route.moduleId === 'finance' && route.section === 0 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><FinanceSetupWorkspace language={language} /></Suspense> : route.moduleId === 'finance' && route.section === 1 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><InvoiceRegisterWorkspace language={language} /></Suspense> : route.moduleId === 'finance' && route.section === 2 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingVaults}</section>}><TreasuryWorkspace language={language} /></Suspense> : route.moduleId === 'finance' && route.section === 3 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><FinanceAccountsWorkspace language={language} /></Suspense> : route.moduleId === 'finance' && route.section === 4 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><CategoriesWorkspace language={language} /></Suspense> : route.moduleId === 'operations' && route.section === 3 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingExpensesObligations}</section>}><ExpensesObligationsWorkspace language={language} activeTab={route.stage === "batch" || route.stage === "history" ? route.stage : "items"} onTabChange={onStage} /></Suspense> : route.moduleId === 'operations' && route.section === 4 ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingFinanceSetup}</section>}><FinanceSetupWorkspace language={language} view="suppliers" /></Suspense> : route.moduleId === 'administration' ? <Suspense fallback={<section className="module-page__placeholder">{text.loadingAdministration}</section>}><AdministrationWorkspace language={language} section={route.section} /></Suspense> : route.moduleId === 'command' && route.section === 0 ? <Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><CommandCenterSalesCalendar language={language} /></Suspense> : <><section className="hero-panel"><div><span className="eyebrow">{module.title[language]}</span><h2>{language === 'ar' ? `مرحبًا بك في ${sectionTitle}` : `Welcome to ${sectionTitle}`}</h2></div></section><section className="module-page__placeholder" /></>}</section>
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
  const [background, setBackground] = useState<LauncherBackground>(() => {
    const stored = localStorage.getItem(launcherBackgroundStorageKey);
    return stored === 'emerald-dark' || stored === 'architectural-light' || stored === 'desert-night' || stored === 'saudi-heritage' || stored === 'emerald-glass' || stored === 'emerald-light' ? stored : 'emerald-light';
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
    document.body.dataset.launcherBackground = background;
    localStorage.setItem(launcherBackgroundStorageKey, background);
  }, [background]);
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
    persistRoute(next);
    window.location.hash = routeHash(next);
    setRoute(next);
  };
  const clear = () => {
    try { sessionStorage.removeItem(routeSessionKey); } catch { /* session storage can be unavailable */ }
    history.replaceState(null, "", window.location.pathname);
    setRoute(null);
  };
  const toggleLanguage = () => setLanguage((current) => current === "ar" ? "en" : "ar");
  const signOut = () => {
    const session = activeSession();
    try { sessionStorage.removeItem(routeSessionKey); } catch { /* session storage can be unavailable */ }
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
    ? <ModuleWorkspace route={route} language={language} theme={theme} background={background} onLanguage={toggleLanguage} onTheme={setTheme} onBackground={setBackground} onModules={clear} onSection={(section) => open({ moduleId: route.moduleId, section })} onStage={(stage) => open({ ...route, stage })} onSignOut={signOut} permissionCodes={permissionCodes} />
    : <ModuleLauncher language={language} theme={theme} background={background} onLanguage={toggleLanguage} onTheme={setTheme} onBackground={setBackground} onOpen={open} onSignOut={signOut} permissionCodes={permissionCodes} />;
}
