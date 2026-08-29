import { lazy, Suspense, useEffect, useState } from 'react';
import { BaseerBrand } from './baseer-brand';
import { BaseerAppShell } from './baseer-app-shell';
import { BaseerLogin } from './baseer-login';
import { BaseerModuleIcon } from './baseer-module-icon';
const BaseerSectionIcon = lazy(async () => ({ default: (await import('./baseer-section-icon')).BaseerSectionIcon }));
const CompanySessionControl = lazy(async () => ({ default: (await import('./company-session-control')).CompanySessionControl }));
const InboundEvidenceWorkspace = lazy(async () => ({ default: (await import('./inbound-evidence-workspace')).InboundEvidenceWorkspace }));
const OperationsInternalRegistrationWorkspace = lazy(async () => ({ default: (await import('./operations-internal-registration-workspace')).OperationsInternalRegistrationWorkspace }));
const OwnerDailyBriefWorkspace = lazy(async () => ({ default: (await import('./owner-daily-brief-workspace')).OwnerDailyBriefWorkspace }));
const QuickAdvanceDialog = lazy(async () => ({ default: (await import('./quick-advance-dialog')).QuickAdvanceDialog }));
const AttendanceEmployeePortal = lazy(async () => ({ default: (await import('./attendance-employee-portal')).AttendanceEmployeePortal }));
const WorkspacePageContent = lazy(async () => ({ default: (await import('./workspace-page-content')).WorkspacePageContent }));
import { getModule, modules, type ModuleId } from './modules';
import { activeSession, clearActiveSession, listAvailableCompanies, signOutActiveSession } from './daily-sales-client';
import { canOpenRoute, setActivePermissionCodes, visibleModules } from './module-access';
import { appText } from './app-copy';
import { getPage, getPageByLegacySection, pageRouteHash, pagesForModule, type PageId } from './page-registry';

type Language = 'ar' | 'en';
type Theme = 'green' | 'blue' | 'plum' | 'classic';
type Appearance = 'light' | 'dark' | 'system';
type AppBackground = 'product-light' | 'product-white' | 'product-soft' | 'product-gray' | 'product-dark' | 'product-dimmed' | 'product-night';
type ContainerSurface = 'white' | 'soft' | 'tinted' | 'beige' | 'gray';
type ResolvedRoute = { moduleId: ModuleId; section: number; pageId: PageId; stage?: string };

type Route = ResolvedRoute | null;

const recentStorageKey = 'baseer-erp.shell.recent.v2';
const legacyRecentStorageKey = 'baseer-erp.shell.recent.v1';
const themeStorageKey = 'baseer-erp.shell.theme.v1';
const appearanceStorageKey = 'baseer-erp.shell.appearance.v1';
const launcherBackgroundStorageKey = 'baseer-erp.shell.app-background.v2';
const containerSurfaceStorageKey = 'baseer-erp.shell.container-surface.v1';
const languageStorageKey = 'baseer.ui.locale.v1';
const routeSessionKey = 'baseer.erp.shell.route.v2';
const legacyRouteSessionKey = 'baseer.erp.shell.route.v1';



function readAppearancePreference(): Appearance {
  try {
    const stored = localStorage.getItem(appearanceStorageKey);
    return stored === 'dark' || stored === 'system' || stored === 'light' ? stored : 'light';
  } catch {
    return 'light';
  }
}

function ThemePicker({ language, theme, onTheme, background, onBackground }: { language: Language; theme: Theme; onTheme: (theme: Theme) => void; background?: AppBackground; onBackground?: (background: AppBackground) => void }) {
  const text = appText(language);
  const [appearance, setAppearance] = useState<Appearance>(readAppearancePreference);
  const colors: Record<Theme, string> = { green: "#087f54", blue: "#1268a7", plum: "#7650a7", classic: "#9a7139" };
  const backgrounds: ReadonlyArray<{ id: AppBackground; ar: string; en: string; color: string }> = [{ id: 'product-white', ar: 'أبيض عالمي', en: 'Global white', color: '#ffffff' }, { id: 'product-light', ar: 'محايد نهاري', en: 'Product light', color: '#f6f8fa' }, { id: 'product-soft', ar: 'محايد ناعم', en: 'Soft neutral', color: '#f4f7f4' }, { id: 'product-gray', ar: 'رمادي متوسط', en: 'Medium gray', color: '#8c8c8c' }, { id: 'product-dark', ar: 'ليلي عميق', en: 'Product dark', color: '#0d1117' }, { id: 'product-dimmed', ar: 'داكن هادئ', en: 'Product dimmed', color: '#22272e' }, { id: 'product-night', ar: 'فحمي ليلي', en: 'Product night', color: '#161b22' }];
  const containerSurfaces: ReadonlyArray<{ id: ContainerSurface; ar: string; en: string; color: string }> = [{ id: 'white', ar: 'أبيض صلب', en: 'Solid white', color: '#ffffff' }, { id: 'soft', ar: 'هادئ', en: 'Soft neutral', color: '#f5f8f6' }, { id: 'tinted', ar: 'من لون النظام', en: 'Brand tint', color: '#e8f4ed' }, { id: 'beige', ar: 'بيج هادئ', en: 'Soft beige', color: '#f6f0e6' }, { id: 'gray', ar: 'رمادي فاتح', en: 'Light gray', color: '#f1f3f5' }];
  const [containerSurface, setContainerSurface] = useState<ContainerSurface>(() => {
    try {
      const stored = localStorage.getItem(containerSurfaceStorageKey);
      return stored === 'soft' || stored === 'tinted' || stored === 'beige' || stored === 'gray' || stored === 'white' ? stored : 'white';
    } catch { return 'white'; }
  });
  useEffect(() => {
    document.body.dataset.containerSurface = containerSurface;
    try { localStorage.setItem(containerSurfaceStorageKey, containerSurface); } catch { /* Local storage can be unavailable. */ }
  }, [containerSurface]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.body.dataset.colorScheme = appearance === 'system' ? (media.matches ? 'dark' : 'light') : appearance;
      localStorage.setItem(appearanceStorageKey, appearance);
    };
    apply();
    if (appearance !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
  const appearances: ReadonlyArray<{ id: Appearance; label: string; icon: string }> = [
    { id: 'light', label: text.appearanceLight, icon: '☀' },
    { id: 'dark', label: text.appearanceDark, icon: '☾' },
    { id: 'system', label: text.appearanceSystem, icon: '◐' },
  ];
  return <details className="theme-button">
    <summary aria-label={text.themePicker}><span className="theme-dot" style={{ width: "14px", height: "14px", background: colors[theme] }} /></summary>
    <div className="theme-picker-menu">
      <section className="appearance-picker"><p>{text.appearance}</p><div>{appearances.map((item) => <button key={item.id} type="button" onClick={() => setAppearance(item.id)} className={appearance === item.id ? 'is-selected' : ''} aria-pressed={appearance === item.id}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</div></section>
      <div className="theme-color-grid">{(["green", "blue", "plum", "classic"] as const).map((item) => <button key={item} type="button" aria-label={item} onClick={(event) => { onTheme(item); event.currentTarget.closest("details")?.removeAttribute("open"); }} style={{ background: colors[item] }} className={theme === item ? 'is-selected' : ''} />)}</div>
      {background && onBackground ? <section className="launcher-background-picker">
        <p>{language === 'ar' ? 'خلفيات نهارية' : 'Day backgrounds'}</p>
        <div className="launcher-background-choice-grid">{backgrounds.slice(0, 4).map((item) => <button key={item.id} type="button" onClick={() => onBackground(item.id)} className={background === item.id ? 'is-selected' : ''} aria-pressed={background === item.id}><span className="launcher-background-swatch" style={{ backgroundColor: item.color }} /><span>{language === 'ar' ? item.ar : item.en}</span><b>✓</b></button>)}</div>
        <p>{language === 'ar' ? 'خلفيات ليلية' : 'Night backgrounds'}</p>
        <div className="launcher-background-choice-grid">{backgrounds.slice(4).map((item) => <button key={item.id} type="button" onClick={() => onBackground(item.id)} className={background === item.id ? 'is-selected' : ''} aria-pressed={background === item.id}><span className="launcher-background-swatch" style={{ backgroundColor: item.color }} /><span>{language === 'ar' ? item.ar : item.en}</span><b>✓</b></button>)}</div>
        <div className="container-surface-picker"><p>{language === 'ar' ? 'أسلوب الحاويات' : 'Container surfaces'}</p><div>{containerSurfaces.map((item) => <button key={item.id} type="button" onClick={() => setContainerSurface(item.id)} className={containerSurface === item.id ? 'is-selected' : ''} aria-pressed={containerSurface === item.id}><span style={{ backgroundColor: item.color }} /><span>{language === 'ar' ? item.ar : item.en}</span></button>)}</div></div>
      </section> : null}
    </div>
  </details>;
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
  return pageRouteHash(route.pageId, route.stage);
}
function persistRoute(route: ResolvedRoute): void {
  try { sessionStorage.setItem(routeSessionKey, routeHash(route)); } catch { /* session storage can be unavailable */ }
}
function parseRouteValue(value: string): Route {
  const params = new URLSearchParams(value.replace(/^#/, ''));
  const moduleId = params.get('module');
  const pageId = params.get('page');
  const sectionValue = params.get('section');
  const stage = params.get('stage');
  const module = modules.find((item) => item.id === moduleId);
  if (!module || (stage !== null && !/^[a-z][a-z0-9-]{0,31}$/.test(stage))) return null;

  const legacySection = sectionValue === null ? undefined : Number(sectionValue);
  const page = pageId === null
    ? (legacySection === undefined ? undefined : getPageByLegacySection(module.id, legacySection))
    : getPage(pageId);
  if (!page || page.moduleId !== module.id || (legacySection !== undefined && (!Number.isInteger(legacySection) || page.legacySection !== legacySection))) return null;
  return { moduleId: page.moduleId, section: page.legacySection, pageId: page.id, ...(stage ? { stage } : {}) };
}
function parseRoute(): Route {
  const fromHash = parseRouteValue(window.location.hash);
  if (fromHash) { persistRoute(fromHash); return fromHash; }
  if (window.location.hash) return null;
  try { return parseRouteValue(sessionStorage.getItem(routeSessionKey) ?? sessionStorage.getItem(legacyRouteSessionKey) ?? ''); } catch { return null; }
}

function routeIdentity(route: ResolvedRoute): string {
  return `${route.moduleId}:${route.pageId}`;
}

function parseRecentValue(value: string): ResolvedRoute | null {
  const canonical = parseRouteValue(value);
  if (canonical) return canonical;
  const [moduleId, sectionValue] = value.split(':');
  return parseRouteValue(`module=${moduleId}&section=${sectionValue}`);
}

function readRecent(): ResolvedRoute[] {
  try {
    const values = [recentStorageKey, legacyRecentStorageKey].flatMap((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    });
    return values.flatMap((value): ResolvedRoute[] => {
      const route = parseRecentValue(value);
      return route ? [route] : [];
    }).filter((route, index, routes) => routes.findIndex((candidate) => routeIdentity(candidate) === routeIdentity(route)) === index).slice(0, 4);
  } catch {
    return [];
  }
}

function persistRecent(route: ResolvedRoute): void {
  const key = routeIdentity(route);
  const values = readRecent().map(routeHash).filter((value) => parseRecentValue(value) && routeIdentity(parseRecentValue(value)!) !== key);
  localStorage.setItem(recentStorageKey, JSON.stringify([routeHash(route), ...values].slice(0, 4)));
}

function firstAllowedRouteForModule(moduleId: ModuleId, permissionCodes: readonly string[] | null): ResolvedRoute | null {
  const page = [...pagesForModule(moduleId)]
    .sort((left, right) => left.navigation.order - right.navigation.order)
    .find((candidate) => candidate.navigation.visible && canOpenRoute({ moduleId: candidate.moduleId, section: candidate.legacySection }, permissionCodes));
  return page ? { moduleId: page.moduleId, section: page.legacySection, pageId: page.id } : null;
}

function preferredAllowedRoute(moduleId: ModuleId, permissionCodes: readonly string[] | null): ResolvedRoute | null {
  // A module is an entry point, not a resume action. Recent pages remain
  // available on the launcher, but selecting a module always starts at its
  // first permitted section for a predictable, role-aware landing page.
  return firstAllowedRouteForModule(moduleId, permissionCodes);
}

function companyIsOwner(company: { isOwner?: boolean; permissionCodes: readonly string[] } | undefined): boolean {
  if (company?.isOwner !== undefined) return company.isOwner;
  // Compatibility with an already-running API that predates the explicit
  // isOwner response field. The legacy owner response always includes this
  // owner-only surface; new API responses use the explicit boolean instead.
  return company?.permissionCodes.includes("inbound_evidence.owner_access") ?? false;
}

function routeTitle(route: ResolvedRoute, language: Language): string {
  return getPage(route.pageId)?.title[language] ?? '';
}

function navigationRoutes(moduleId: ModuleId, permissionCodes: readonly string[] | null): ResolvedRoute[] {
  return [...pagesForModule(moduleId)]
    .sort((left, right) => left.navigation.order - right.navigation.order)
    .flatMap((page): ResolvedRoute[] => page.navigation.visible && canOpenRoute({ moduleId: page.moduleId, section: page.legacySection }, permissionCodes)
      ? [{ moduleId: page.moduleId, section: page.legacySection, pageId: page.id }]
      : []);
}

function SignOutIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="m14 8 4 4-4 4M18 12H8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function HomeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3.5 10.5 8.5-7 8.5 7V20a1 1 0 0 1-1 1h-5v-5.75h-5V21h-5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function QuickActionsMenu({ language, permissionCodes, onQuickAdvance }: { language: Language; permissionCodes: readonly string[] | null; onQuickAdvance: () => void }) {
  const canIssueAdvance = permissionCodes?.includes("hr.advances.issue") ?? false;
  if (!canIssueAdvance) return null;
  const label = language === "ar" ? "إجراءات سريعة" : "Quick actions";
  return <details className="quick-actions"><summary aria-label={label} title={label}>+</summary><div className="quick-actions__menu"><button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onQuickAdvance(); }}><span aria-hidden="true">₊</span><span>{language === "ar" ? "إدخال سلفة" : "Enter advance"}</span></button></div></details>;
}

function AppHeader({ language, theme, background, activeModuleId, permissionCodes, onLanguage, onTheme, onBackground, onModules, onOpenModule, onQuickAdvance, onSignOut }: { language: Language; theme: Theme; background: AppBackground; activeModuleId: ModuleId; permissionCodes: readonly string[] | null; onLanguage: () => void; onTheme: (theme: Theme) => void; onBackground: (background: AppBackground) => void; onModules: () => void; onOpenModule: (moduleId: ModuleId) => void; onQuickAdvance: () => void; onSignOut: () => void }) {
  const text = appText(language);
  const [moduleNavigationOpen, setModuleNavigationOpen] = useState(false);
  const availableModules = visibleModules(permissionCodes);
  const homeLabel = language === "ar" ? "الصفحة الرئيسية" : "Home";
  useEffect(() => {
    setModuleNavigationOpen(false);
  }, [activeModuleId]);
  useEffect(() => {
    if (!moduleNavigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModuleNavigationOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moduleNavigationOpen]);
  const toggleModuleNavigation = () => {
    if (window.matchMedia("(max-width: 800px)").matches) {
      onModules();
      return;
    }
    setModuleNavigationOpen((open) => !open);
  };
  const openModule = (moduleId: ModuleId) => {
    setModuleNavigationOpen(false);
    onOpenModule(moduleId);
  };
  return <header className="topbar">
    <div className={`header-module-launcher${moduleNavigationOpen ? " is-open" : ""}`}>
      <button className="icon-button header-home-button" onClick={() => { setModuleNavigationOpen(false); onModules(); }} type="button" aria-label={homeLabel} title={homeLabel}><HomeIcon /></button>
      <button className="icon-button app-modules-button" onClick={toggleModuleNavigation} type="button" aria-label={text.allModules} title={text.allModules} aria-expanded={moduleNavigationOpen} aria-controls="header-module-switcher">{"\u283f"}</button>
      <nav id="header-module-switcher" className="header-module-switcher" aria-label={text.allModules}>
        {availableModules.map((module, index) => <button key={module.id} type="button" className={module.id === activeModuleId ? 'is-active' : ''} style={{ "--module-index": index } as React.CSSProperties} onClick={() => openModule(module.id)} aria-current={module.id === activeModuleId ? 'page' : undefined} aria-label={module.title[language]} title={module.title[language]} disabled={module.id === activeModuleId}>{(module.launcherTitle ?? module.title)[language]}</button>)}
      </nav>
    </div>
    <div className="topbar-spacer" />
    <QuickActionsMenu language={language} permissionCodes={permissionCodes} onQuickAdvance={onQuickAdvance} />
    <Suspense fallback={null}><CompanySessionControl language={language} /></Suspense>
    <button className="text-button" onClick={onLanguage} type="button">{language === 'ar' ? text.switchToEnglish : text.switchToArabic}</button>
    <ThemePicker language={language} theme={theme} onTheme={onTheme} background={background} onBackground={onBackground} />
    <button className="header-signout" onClick={onSignOut} type="button" aria-label={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'} title={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}><SignOutIcon /></button>
  </header>;
}

function ModuleLauncher({ language, theme, background, onLanguage, onTheme, onBackground, onOpen, onQuickAdvance, onSignOut, permissionCodes }: { language: Language; theme: Theme; background: AppBackground; onLanguage: () => void; onTheme: (theme: Theme) => void; onBackground: (background: AppBackground) => void; onOpen: (route: ResolvedRoute) => void; onQuickAdvance: () => void; onSignOut: () => void; permissionCodes: readonly string[] | null }) {
  const [recent, setRecent] = useState<ResolvedRoute[]>(readRecent);
  const text = appText(language);
  const visible = visibleModules(permissionCodes);
  const open = (route: ResolvedRoute) => { if (!canOpenRoute(route, permissionCodes)) return; onOpen(route); setRecent(readRecent()); };
  return <div className="launcher-page">
    <header className="launcher-topbar"><button className="launcher-brand-anchor sidebar-brand brand-button" style={{ transform: "translateY(11px)" }} type="button"><BaseerBrand /></button><div className="topbar-spacer" /><QuickActionsMenu language={language} permissionCodes={permissionCodes} onQuickAdvance={onQuickAdvance} /><Suspense fallback={null}><CompanySessionControl language={language} /></Suspense><button className="text-button" onClick={onLanguage} type="button">{language === 'ar' ? text.switchToEnglish : text.switchToArabic}</button><ThemePicker language={language} theme={theme} onTheme={onTheme} background={background} onBackground={onBackground} /><button className="header-signout" onClick={onSignOut} type="button" aria-label={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'} title={language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}><SignOutIcon /></button></header>
    <main className="launcher-page__content">
      <div className="launcher-page__heading"><p className="launcher-kicker">Baseer ERP</p><h1>{text.choose}</h1></div>
      {recent.filter((route) => canOpenRoute(route, permissionCodes)).length > 0 && <section className="recent"><h2>{text.recent}</h2><div className="recent__list">{recent.filter((route) => canOpenRoute(route, permissionCodes)).map((route) => { const module = getModule(route.moduleId); return <button key={routeIdentity(route)} onClick={() => open(route)} type="button">{module.title[language]} · {routeTitle(route, language)}</button>; })}</div></section>}
      <section className="modules-grid launcher-page__grid">{visible.map((module) => <button key={module.id} type="button" className="module-card" aria-label={module.title[language]} title={module.title[language]} style={{ '--module': module.accent, '--module-alt': module.accentAlt } as React.CSSProperties} onClick={() => { const route = preferredAllowedRoute(module.id, permissionCodes); if (route) open(route); }}><span className="module-icon-panel" aria-hidden="true"><span className="module-icon"><BaseerModuleIcon moduleId={module.id} /></span></span><span className="module-copy"><strong>{(module.launcherTitle ?? module.title)[language]}</strong></span></button>)}</section>
      {visible.length === 0 && <p className="empty-results">{text.noResults}</p>}

    </main>
  </div>;
}

function Navigation({ moduleId, active, language, onSelect, permissionCodes }: { moduleId: ModuleId; active: ResolvedRoute; language: Language; onSelect: (route: ResolvedRoute) => void; permissionCodes: readonly string[] | null }) {
  const routes = navigationRoutes(moduleId, permissionCodes);
  return <nav className="module-navigation">{routes.map((route, position) => {
    const label = routeTitle(route, language);
    const page = getPage(route.pageId);
    const colors = ['#36b37e', '#42a5f5', '#ff9f43', '#c77dff', '#f5bd1f', '#fb7185'];
    return <button key={routeIdentity(route)} type="button" onClick={() => onSelect(route)} className={"nav-item" + (routeIdentity(route) === routeIdentity(active) ? " active" : "")}><span className="nav-icon" style={{ '--section-accent': colors[position % colors.length] } as React.CSSProperties}><BaseerSectionIcon glyph={page?.icon ?? "dashboard"} /></span><span>{label}</span></button>;
  })}</nav>;
}
function ModuleWorkspaceContents({ route, language, theme, background, onLanguage, onTheme, onBackground, onModules, onOpenModule, onRoute, onStage, onQuickAdvance, onSignOut, permissionCodes, isOwner }: { route: ResolvedRoute; language: Language; theme: Theme; background: AppBackground; onLanguage: () => void; onTheme: (theme: Theme) => void; onBackground: (background: AppBackground) => void; onModules: () => void; onOpenModule: (moduleId: ModuleId) => void; onRoute: (route: ResolvedRoute) => void; onStage: (stage: string) => void; onQuickAdvance: () => void; onSignOut: () => void; permissionCodes: readonly string[] | null; isOwner: boolean }) {
  const module = getModule(route.moduleId);
  const text = appText(language);
  const sectionTitle = routeTitle(route, language);
  const navigation = <Navigation moduleId={module.id} active={route} language={language} onSelect={onRoute} permissionCodes={permissionCodes} />;
  const header = <AppHeader language={language} theme={theme} background={background} activeModuleId={route.moduleId} permissionCodes={permissionCodes} onLanguage={onLanguage} onTheme={onTheme} onBackground={onBackground} onModules={onModules} onOpenModule={onOpenModule} onQuickAdvance={onQuickAdvance} onSignOut={onSignOut} />;
  const shell = (content: React.ReactNode, options?: { navigation?: boolean; pageClassName?: string }) => <BaseerAppShell header={header} moduleTitle={module.title[language]} currentModuleLabel={text.currentModule} sectionTitle={sectionTitle} sectionsLabel={text.sections} closeLabel={text.close} onModules={onModules} navigation={options?.navigation === false ? undefined : navigation} navigationKey={routeIdentity(route)} pageClassName={options?.pageClassName}>{content}</BaseerAppShell>;
  if (route.moduleId === "command" && route.section === 3) return shell(<Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><OwnerDailyBriefWorkspace language={language} /></Suspense>);
  // This is deliberately a focused workstation. A bar/kitchen employee who
  // only has the registration capability is never shown the wider operations
  // navigation or any financial/management screen.
  if (route.moduleId === "operations" && route.section === 7) return shell(<Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><OperationsInternalRegistrationWorkspace language={language} /></Suspense>, { navigation: isOwner });
  if (route.moduleId === "inbound-evidence") return shell(<Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><InboundEvidenceWorkspace language={language} section={route.section} /></Suspense>);
  return shell(<Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><WorkspacePageContent route={route} language={language} permissionCodes={permissionCodes} onStage={onStage} loading={text.loading} loadingPurchases={text.loadingPurchases} loadingFinanceSetup={text.loadingFinanceSetup} loadingVaults={text.loadingVaults} loadingAdministration={text.loadingAdministration} /></Suspense>, { pageClassName: route.moduleId === "hr" ? "module-page--hr" : undefined });
}

const WorkspaceStyles = lazy(async () => ({ default: (await import('./workspace-styles')).default }));

function ModuleWorkspace(props: Parameters<typeof ModuleWorkspaceContents>[0]) {
  const text = appText(props.language);
  return <Suspense fallback={<section className="module-page__placeholder" aria-busy="true">{text.loading}</section>}><WorkspaceStyles /><ModuleWorkspaceContents {...props} /></Suspense>;
}

export function App() {
  const [authenticationRevision, setAuthenticationRevision] = useState(0);
  const [language, setLanguage] = useState<Language>(readLanguagePreference);
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(themeStorageKey);
    return stored === "blue" || stored === "plum" || stored === "classic" || stored === "green" ? stored : "green";
  });
  const [background, setBackground] = useState<AppBackground>(() => {
    const stored = localStorage.getItem(launcherBackgroundStorageKey);
    return stored === 'product-light' || stored === 'product-white' || stored === 'product-soft' || stored === 'product-gray' || stored === 'product-dark' || stored === 'product-dimmed' || stored === 'product-night' ? stored : 'product-white';
  });
  const [route, setRoute] = useState<Route>(parseRoute);
  const [permissionCodes, setPermissionCodes] = useState<string[] | null>(null);
  const [activeCompanyIsOwner, setActiveCompanyIsOwner] = useState(false);
  const [permissionRetry, setPermissionRetry] = useState(0);
  const [quickAdvanceOpen, setQuickAdvanceOpen] = useState(false);

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
    if (!route || !window.location.hash || window.location.hash.slice(1) === routeHash(route)) return;
    // Old numeric finance links stay readable, then become the immutable page
    // link without adding a browser-history entry.
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${routeHash(route)}`);
  }, [route]);
  useEffect(() => {
    const session = activeSession();
    if (!session) { setPermissionCodes(null); setActiveCompanyIsOwner(false); setActivePermissionCodes([]); return; }
    setActivePermissionCodes([]);
    let cancelled = false;
    void listAvailableCompanies(session).then((companies) => {
      const active = companies.find((company) => company.id === session.companyId);
      if (!cancelled) {
        const codes = active?.permissionCodes ?? [];
        setPermissionCodes(codes);
        setActiveCompanyIsOwner(companyIsOwner(active));
        setActivePermissionCodes(codes);
        if (permissionRetry) setPermissionRetry(0);
      }
    }).catch(() => {
      if (cancelled) return;
      // A transient failure must not be misrepresented as a role with no
      // financial or HR access. Keep the normal loading shell and retry once;
      // API endpoints remain the authority for every subsequent read/write.
      setPermissionCodes(null);
      setActiveCompanyIsOwner(false);
      setActivePermissionCodes([]);
      if (permissionRetry < 1) window.setTimeout(() => setPermissionRetry((attempt) => attempt + 1), 900);
    });
    return () => { cancelled = true; };
  }, [authenticationRevision, permissionRetry, route?.moduleId, route?.section]);

  const open = (next: ResolvedRoute) => {
    persistRecent(next);
    persistRoute(next);
    window.location.hash = routeHash(next);
    setRoute(next);
  };
  const clear = () => {
    try { sessionStorage.removeItem(routeSessionKey); sessionStorage.removeItem(legacyRouteSessionKey); } catch { /* session storage can be unavailable */ }
    history.replaceState(null, "", window.location.pathname);
    setRoute(null);
  };
  const toggleLanguage = () => setLanguage((current) => current === "ar" ? "en" : "ar");
  const signOut = () => {
    const session = activeSession();
    try { sessionStorage.removeItem(routeSessionKey); sessionStorage.removeItem(legacyRouteSessionKey); } catch { /* session storage can be unavailable */ }
    clearActiveSession();
    const reload = () => window.location.reload();
    if (!session) { reload(); return; }
    void signOutActiveSession(session.accessToken).catch(() => undefined).finally(reload);
  };

  useEffect(() => {
    if (!route || permissionCodes === null || canOpenRoute(route, permissionCodes)) return;
    const replacement = firstAllowedRouteForModule(route.moduleId, permissionCodes)
      ?? visibleModules(permissionCodes).flatMap((module) => {
        const next = firstAllowedRouteForModule(module.id, permissionCodes);
        return next ? [next] : [];
      })[0];
    if (replacement) open(replacement); else clear();
  }, [permissionCodes, route]);

  const session = activeSession();
  // This is the intentionally minimal employee PWA route. It does not create
  // a Baseer ERP browser session; the attendance API verifies the signed QR,
  // PIN and one-time location on the server.
  if (/^#attendance(?:[?=&]|$)/.test(window.location.hash)) {
    return <Suspense fallback={<main className="module-page__placeholder" aria-busy="true" />}><AttendanceEmployeePortal language={language} /></Suspense>;
  }
  if (!session) {
    return <BaseerLogin
      language={language}
      onLanguage={toggleLanguage}
      themeControl={<ThemePicker language={language} theme={theme} onTheme={setTheme} />}
      onAuthenticated={() => setAuthenticationRevision((current) => current + 1)}
    />;
  }
  if (permissionCodes === null) {
    return <main className="module-page__placeholder" aria-busy="true"><p role="status">{appText(language).checkingAccess}</p></main>;
  }
  const openQuickAdvance = () => setQuickAdvanceOpen(true);
  return <>
    {quickAdvanceOpen ? <Suspense fallback={null}><QuickAdvanceDialog open language={language} onClose={() => setQuickAdvanceOpen(false)} /></Suspense> : null}
    {route
      ? <ModuleWorkspace route={route} language={language} theme={theme} background={background} onLanguage={toggleLanguage} onTheme={setTheme} onBackground={setBackground} onModules={clear} onOpenModule={(moduleId) => { const destination = preferredAllowedRoute(moduleId, permissionCodes); if (destination) open(destination); }} onRoute={open} onStage={(stage) => open({ ...route, stage })} onQuickAdvance={openQuickAdvance} onSignOut={signOut} permissionCodes={permissionCodes} isOwner={activeCompanyIsOwner} />
      : <ModuleLauncher language={language} theme={theme} background={background} onLanguage={toggleLanguage} onTheme={setTheme} onBackground={setBackground} onOpen={open} onQuickAdvance={openQuickAdvance} onSignOut={signOut} permissionCodes={permissionCodes} />}
  </>;
}
