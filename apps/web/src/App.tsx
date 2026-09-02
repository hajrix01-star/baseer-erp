import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BaseerBrand } from './baseer-brand';
import { BaseerAppShell, type BaseerShellHeaderContext } from './baseer-app-shell';
import { BaseerLogin } from './baseer-login';
import { BaseerModuleIcon } from './baseer-module-icon';
import { BaseerWorkspaceErrorBoundary } from './baseer-workspace-error-boundary';
const CompanySessionControl = lazy(async () => ({ default: (await import('./company-session-control')).CompanySessionControl }));
const InboundEvidenceWorkspace = lazy(async () => ({ default: (await import('./inbound-evidence-workspace')).InboundEvidenceWorkspace }));
const OperationsInternalRegistrationWorkspace = lazy(async () => ({ default: (await import('./operations-internal-registration-workspace')).OperationsInternalRegistrationWorkspace }));
const AttendanceEmployeePortal = lazy(async () => ({ default: (await import('./attendance-employee-portal')).AttendanceEmployeePortal }));
const WorkspacePageContent = lazy(async () => ({ default: (await import('./workspace-page-content')).WorkspacePageContent }));
import { getModule, modules, type ModuleId } from './modules';
import { activeSession, activeSessionChangedEvent, clearActiveSession, listAvailableCompanies, selectActiveCompany, signOutActiveSession } from './daily-sales-client';
import { canOpenRoute, setActivePermissionCodes, visibleModules } from './module-access';
import { appText } from './app-copy';
import { getPage, getPageByLegacySection, pageRouteHash, pagesForModule, type PageId } from './page-registry';
import { ThemeNavigation } from './baseer-theme-navigation';

type Language = 'ar' | 'en';
type UiPresentation = 'modern-3';
type Appearance = 'light' | 'dark' | 'system';
type ColorPalette = 'calm-green' | 'editorial-copper' | 'modern-admin';
type ResolvedRoute = { moduleId: ModuleId; section: number; pageId: PageId; stage?: string };

type Route = ResolvedRoute | null;

const recentStorageKey = 'baseer-erp.shell.recent.v2';
const legacyRecentStorageKey = 'baseer-erp.shell.recent.v1';
const uiPresentationStorageKey = 'baseer-erp.shell.presentation.v1';
const colorPaletteStorageKey = 'baseer-erp.shell.color-palette.v1';
const appearanceStorageKey = 'baseer-erp.shell.appearance.v1';
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

function readUiPresentationPreference(): UiPresentation {
  try {
    const stored = localStorage.getItem(uiPresentationStorageKey);
    if (stored !== 'modern-3') localStorage.setItem(uiPresentationStorageKey, 'modern-3');
  } catch {
    // The UI remains deterministic when browser storage is unavailable.
  }
  return 'modern-3';
}

function readColorPalettePreference(): ColorPalette {
  try {
    const stored = localStorage.getItem(colorPaletteStorageKey);
    if (stored === 'calm-green' || stored === 'editorial-copper' || stored === 'modern-admin') return stored;
    // Preserve a person's previous visual intent before the legacy presentation
    // key is normalised to modern-3. Old presentations become colour only.
    const legacyPresentation = localStorage.getItem(uiPresentationStorageKey);
    const palette: ColorPalette = legacyPresentation === 'modern-1'
      ? 'calm-green'
      : legacyPresentation === 'modern-2'
        ? 'editorial-copper'
        : 'modern-admin';
    localStorage.setItem(colorPaletteStorageKey, palette);
    return palette;
  } catch {
    return 'modern-admin';
  }
}

function ThemePicker({ language, palette, onPalette, className = 'theme-button', showLabel = false }: { language: Language; palette: ColorPalette; onPalette: (palette: ColorPalette) => void; className?: string; showLabel?: boolean }) {
  const text = appText(language);
  const [appearance, setAppearance] = useState<Appearance>(readAppearancePreference);
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
  const palettes: ReadonlyArray<{ id: ColorPalette; label: string; swatch: string }> = [
    { id: 'calm-green', label: text.paletteCalmGreen, swatch: '#16815f' },
    { id: 'editorial-copper', label: text.paletteEditorialCopper, swatch: '#9c4f28' },
    { id: 'modern-admin', label: text.paletteModernAdmin, swatch: '#127f73' },
  ];
  return <details className={className}>
    <summary aria-label={text.appearance}><span className="theme-dot" style={{ width: "14px", height: "14px", background: 'var(--brand)' }} />{showLabel ? <span className="theme-picker-trigger-label">{text.appearance}</span> : null}</summary>
    <div className="theme-picker-menu">
      <section className="palette-picker"><p>{text.colorPalette}</p><div>{palettes.map((item) => <button key={item.id} type="button" onClick={() => onPalette(item.id)} className={palette === item.id ? 'is-selected' : ''} aria-pressed={palette === item.id}><span className="palette-picker__swatch" style={{ background: item.swatch }} aria-hidden="true" /><span>{item.label}</span></button>)}</div></section>
      <section className="appearance-picker"><p>{text.appearance}</p><div>{appearances.map((item) => <button key={item.id} type="button" onClick={() => setAppearance(item.id)} className={appearance === item.id ? 'is-selected' : ''} aria-pressed={appearance === item.id}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</div></section>
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
  const isEmployeeProfileStage = moduleId === "hr" && /^employee-[a-z0-9-]{1,80}$/.test(stage ?? "");
  if (!module || (stage !== null && !/^[a-z][a-z0-9-]{0,31}$/.test(stage) && !isEmployeeProfileStage)) return null;

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

function NavigationIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
}

function ProfileIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.8" /><path d="M5.25 20c.7-3.28 3.05-5 6.75-5s6.05 1.72 6.75 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 9.5 5 5 5-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** A temporary, opt-in marker for proving the exact remote UI build in use. */
function LiveUiDiagnostic() {
  const enabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("baseer_diag");
  const [details, setDetails] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;
    const inspect = () => {
      const quickAction = document.querySelector<HTMLElement>(".header-quick-actions");
      const quickActionPosition = quickAction ? getComputedStyle(quickAction).position : "missing";
      const chartRevision = document.querySelector("[data-chart-revision]")?.getAttribute("data-chart-revision") ?? "loading";
      const theme = document.body.dataset.uiTheme ?? "none";
      setDetails(`UI 30901 · ${window.innerWidth}px · ${theme} · + ${quickActionPosition} · chart ${chartRevision}`);
    };
    inspect();
    const chartWait = window.setInterval(inspect, 500);
    window.addEventListener("resize", inspect);
    return () => { window.clearInterval(chartWait); window.removeEventListener("resize", inspect); };
  }, [enabled]);

  return enabled ? createPortal(<output className="live-ui-diagnostic" aria-live="polite">{details || "UI 30901 · loading…"}</output>, document.body) : null;
}

function HeaderProfileMenu({ language, palette, onPalette, onLanguage, onSignOut }: { language: Language; palette: ColorPalette; onPalette: (palette: ColorPalette) => void; onLanguage: () => void; onSignOut: () => void }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const isArabic = language === 'ar';
  const profileLabel = isArabic ? 'حسابي وإعدادات الجلسة' : 'My account and session settings';
  const accountLabel = isArabic ? 'حسابي' : 'My account';
  const activeSessionLabel = isArabic ? 'جلسة العمل نشطة' : 'Work session active';
  const preferencesLabel = isArabic ? 'إعدادات الواجهة' : 'Interface settings';
  const signOutLabel = language === 'ar' ? 'تسجيل الخروج' : 'Sign out';
  const signOutHint = isArabic ? 'ستنتقل بعد الخروج إلى شاشة تسجيل الدخول.' : 'Signing out returns you to the login screen.';

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = menuRef.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      event.preventDefault();
      menu.open = false;
      setOpen(false);
      summaryRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return <details ref={menuRef} className="header-profile-menu" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary ref={summaryRef} aria-label={profileLabel} aria-expanded={open} title={profileLabel}>
      <span className="header-profile-menu__trigger-icon"><ProfileIcon /></span>
      <span className="header-profile-menu__trigger-copy"><strong>{accountLabel}</strong><small>{activeSessionLabel}</small></span>
      <ChevronDownIcon />
    </summary>
    <div className="header-profile-menu__panel" role="group" aria-label={profileLabel}>
      <div className="header-profile-menu__identity">
        <span className="header-profile-menu__identity-icon"><ProfileIcon /></span>
        <span><small>{accountLabel}</small><strong>{activeSessionLabel}</strong></span>
      </div>
      <section className="header-profile-menu__preferences" aria-label={preferencesLabel}>
        <p>{preferencesLabel}</p>
        <button className="header-profile-menu__language" onClick={onLanguage} type="button">{language === 'ar' ? 'English' : 'العربية'}</button>
        <ThemePicker language={language} palette={palette} onPalette={onPalette} className="header-profile-menu__appearance" showLabel />
      </section>
      <div className="header-profile-menu__session-action">
        <small>{signOutHint}</small>
        <button className="header-profile-menu__signout" onClick={onSignOut} type="button"><SignOutIcon /><span>{signOutLabel}</span></button>
      </div>
    </div>
  </details>;
}

function AppHeader({ language, palette, onPalette, hasNavigation, drawerOpen, onOpenNavigation, onLanguage, onModules, onSignOut }: { language: Language; palette: ColorPalette; onPalette: (palette: ColorPalette) => void; hasNavigation: boolean; drawerOpen: boolean; onOpenNavigation: () => void; onLanguage: () => void; onModules: () => void; onSignOut: () => void }) {
  const text = appText(language);
  const homeLabel = language === "ar" ? "الصفحة الرئيسية" : "Home";
  return <header className="topbar">
    <div className="header-primary-actions">
      {hasNavigation ? <button className="header-navigation-button" onClick={onOpenNavigation} type="button" aria-label={text.sections} title={text.sections} aria-haspopup="dialog" aria-expanded={drawerOpen}><NavigationIcon /></button> : null}
      <button className="icon-button header-home-button" onClick={onModules} type="button" aria-label={homeLabel} title={homeLabel}><HomeIcon /></button>
    </div>
    <div className="topbar-spacer" />
    <LiveUiDiagnostic />
    <Suspense fallback={null}><CompanySessionControl language={language} /></Suspense>
    <HeaderProfileMenu language={language} palette={palette} onPalette={onPalette} onLanguage={onLanguage} onSignOut={onSignOut} />
  </header>;
}

function ModuleLauncher({ language, palette, onPalette, onLanguage, onOpen, onSignOut, permissionCodes }: { language: Language; palette: ColorPalette; onPalette: (palette: ColorPalette) => void; onLanguage: () => void; onOpen: (route: ResolvedRoute) => void; onSignOut: () => void; permissionCodes: readonly string[] | null }) {
  const [recent, setRecent] = useState<ResolvedRoute[]>(readRecent);
  const text = appText(language);
  const visible = visibleModules(permissionCodes);
  const open = (route: ResolvedRoute) => { if (!canOpenRoute(route, permissionCodes)) return; onOpen(route); setRecent(readRecent()); };
  return <div className="launcher-page">
    <header className="launcher-topbar"><button className="launcher-brand-anchor sidebar-brand brand-button" type="button"><BaseerBrand /></button><div className="topbar-spacer" /><Suspense fallback={null}><CompanySessionControl language={language} /></Suspense><HeaderProfileMenu language={language} palette={palette} onPalette={onPalette} onLanguage={onLanguage} onSignOut={onSignOut} /></header>
    <main className="launcher-page__content">
      <div className="launcher-page__heading"><p className="launcher-kicker">Baseer ERP</p><h1>{text.choose}</h1></div>
      {recent.filter((route) => canOpenRoute(route, permissionCodes)).length > 0 && <section className="recent"><h2>{text.recent}</h2><div className="recent__list">{recent.filter((route) => canOpenRoute(route, permissionCodes)).map((route) => { const module = getModule(route.moduleId); return <button key={routeIdentity(route)} onClick={() => open(route)} type="button">{module.title[language]} · {routeTitle(route, language)}</button>; })}</div></section>}
      <section className="modules-grid launcher-page__grid">{visible.map((module) => <button key={module.id} type="button" className="module-card" aria-label={module.title[language]} title={module.title[language]} style={{ '--module': module.accent, '--module-alt': module.accentAlt } as React.CSSProperties} onClick={() => { const route = preferredAllowedRoute(module.id, permissionCodes); if (route) open(route); }}><span className="module-icon-panel" aria-hidden="true"><span className="module-icon"><BaseerModuleIcon moduleId={module.id} /></span></span><span className="module-copy"><strong>{(module.launcherTitle ?? module.title)[language]}</strong></span></button>)}</section>
      {visible.length === 0 && <p className="empty-results">{text.noResults}</p>}

    </main>
  </div>;
}

function ModuleWorkspaceContents({ route, language, palette, onPalette, onLanguage, onModules, onRoute, onStage, onSignOut, permissionCodes, isOwner, migrationReviewLocked }: { route: ResolvedRoute; language: Language; palette: ColorPalette; onPalette: (palette: ColorPalette) => void; onLanguage: () => void; onModules: () => void; onRoute: (route: ResolvedRoute) => void; onStage: (stage: string) => void; onSignOut: () => void; permissionCodes: readonly string[] | null; isOwner: boolean; migrationReviewLocked: boolean }) {
  const module = getModule(route.moduleId);
  const text = appText(language);
  const sectionTitle = routeTitle(route, language);
  const navigation = <ThemeNavigation active={route} language={language} showPageStages={false} permissionCodes={permissionCodes} onSelect={onRoute} onStage={onStage} />;
  const header = ({ hasNavigation, drawerOpen, onOpenNavigation }: BaseerShellHeaderContext) => <AppHeader language={language} palette={palette} onPalette={onPalette} hasNavigation={hasNavigation} drawerOpen={drawerOpen} onOpenNavigation={onOpenNavigation} onLanguage={onLanguage} onModules={onModules} onSignOut={onSignOut} />;
  const shell = (content: React.ReactNode, options?: { navigation?: boolean; pageClassName?: string }) => <BaseerAppShell header={header} moduleTitle={module.title[language]} currentModuleLabel={text.currentModule} sectionTitle={sectionTitle} sectionsLabel={text.sections} closeLabel={text.close} onModules={onModules} navigation={options?.navigation === false ? undefined : navigation} navigationKey={routeIdentity(route)} pageClassName={options?.pageClassName}>{content}</BaseerAppShell>;
  // This is deliberately a focused workstation. A bar/kitchen employee who
  // only has the registration capability is never shown the wider operations
  // navigation or any financial/management screen.
  if (route.moduleId === "operations" && route.section === 7 && !isOwner) return shell(<Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><OperationsInternalRegistrationWorkspace language={language} /></Suspense>, { navigation: false });
  if (route.moduleId === "inbound-evidence") return shell(<Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><InboundEvidenceWorkspace language={language} section={route.section} /></Suspense>);
  return shell(<Suspense fallback={<section className="module-page__placeholder">{text.loading}</section>}><WorkspacePageContent route={route} language={language} permissionCodes={permissionCodes} migrationReviewLocked={migrationReviewLocked} onStage={onStage} loading={text.loading} loadingPurchases={text.loadingPurchases} loadingFinanceSetup={text.loadingFinanceSetup} loadingVaults={text.loadingVaults} loadingAdministration={text.loadingAdministration} /></Suspense>, { pageClassName: route.moduleId === "hr" ? "module-page--hr" : undefined });
}

const WorkspaceStyles = lazy(async () => ({ default: (await import('./workspace-styles')).default }));

function ModuleWorkspace(props: Parameters<typeof ModuleWorkspaceContents>[0]) {
  const text = appText(props.language);
  return <BaseerWorkspaceErrorBoundary language={props.language}><Suspense fallback={<section className="module-page__placeholder" aria-busy="true">{text.loading}</section>}><WorkspaceStyles /><ModuleWorkspaceContents {...props} /></Suspense></BaseerWorkspaceErrorBoundary>;
}

export function App() {
  const [authenticationRevision, setAuthenticationRevision] = useState(0);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [language, setLanguage] = useState<Language>(readLanguagePreference);
  const [palette, setPalette] = useState<ColorPalette>(readColorPalettePreference);
  const [presentation] = useState<UiPresentation>(readUiPresentationPreference);
  const [route, setRoute] = useState<Route>(parseRoute);
  const [permissionCodes, setPermissionCodes] = useState<string[] | null>(null);
  const [activeCompanyIsOwner, setActiveCompanyIsOwner] = useState(false);
  const [activeCompanyMigrationReviewLocked, setActiveCompanyMigrationReviewLocked] = useState(false);
  const [permissionRetry, setPermissionRetry] = useState(0);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    localStorage.setItem(languageStorageKey, language);
  }, [language]);
  useEffect(() => {
    document.body.dataset.uiTheme = presentation;
    try { localStorage.setItem(uiPresentationStorageKey, presentation); } catch { /* Local storage can be unavailable. */ }
    window.dispatchEvent(new Event('baseer-ui-theme-change'));
  }, [presentation]);
  useEffect(() => {
    document.body.dataset.colorPalette = palette;
    try { localStorage.setItem(colorPaletteStorageKey, palette); } catch { /* Local storage can be unavailable. */ }
    window.dispatchEvent(new Event('baseer-ui-theme-change'));
  }, [palette]);
  useEffect(() => {
    const listener = () => setRoute(parseRoute());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    const listener = () => setSessionRevision((current) => current + 1);
    window.addEventListener(activeSessionChangedEvent, listener);
    return () => window.removeEventListener(activeSessionChangedEvent, listener);
  }, []);
  useEffect(() => {
    if (!route || !window.location.hash || window.location.hash.slice(1) === routeHash(route)) return;
    // Old numeric finance links stay readable, then become the immutable page
    // link without adding a browser-history entry.
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${routeHash(route)}`);
  }, [route]);
  useEffect(() => {
    const session = activeSession();
    if (!session) { setPermissionCodes(null); setActiveCompanyIsOwner(false); setActiveCompanyMigrationReviewLocked(false); setActivePermissionCodes([]); return; }
    setActivePermissionCodes([]);
    let cancelled = false;
    void listAvailableCompanies(session).then((companies) => {
      const active = companies.find((company) => company.id === session.companyId);
      if (!cancelled) {
        // A development reset or a revoked membership can leave a valid token
        // pointing at a company that no longer belongs to this session. When
        // exactly one company is available, recover the selection without
        // making the person sign in again; otherwise return to sign-in rather
        // than rendering every protected page as a generic 403 failure.
        if (!active) {
          if (companies.length === 1) {
            selectActiveCompany(companies[0].id);
          } else {
            clearActiveSession();
          }
          window.location.reload();
          return;
        }
        const owner = companyIsOwner(active);
        // The owner dashboard is tenant-wide and its API authorizes the owner
        // identity, not a capability inherited from the selected company.
        // Keep route discovery aligned with that server authority even when a
        // legacy company response omits the historical evidence capability.
        const codes = owner && !(active?.permissionCodes ?? []).includes("inbound_evidence.owner_access")
          ? [...(active?.permissionCodes ?? []), "inbound_evidence.owner_access"]
          : active?.permissionCodes ?? [];
        setPermissionCodes(codes);
        setActiveCompanyIsOwner(owner);
        setActiveCompanyMigrationReviewLocked(Boolean(active.migrationReviewLocked));
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
      setActiveCompanyMigrationReviewLocked(false);
      setActivePermissionCodes([]);
      if (permissionRetry < 1) window.setTimeout(() => setPermissionRetry((attempt) => attempt + 1), 900);
    });
    return () => { cancelled = true; };
  }, [authenticationRevision, permissionRetry, sessionRevision, route?.moduleId, route?.section]);

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
      themeControl={<ThemePicker language={language} palette={palette} onPalette={setPalette} />}
      onAuthenticated={() => setAuthenticationRevision((current) => current + 1)}
    />;
  }
  if (permissionCodes === null) {
    return <main className="module-page__placeholder" aria-busy="true"><p role="status">{appText(language).checkingAccess}</p></main>;
  }
  return <>
    {route
      ? <ModuleWorkspace route={route} language={language} palette={palette} onPalette={setPalette} onLanguage={toggleLanguage} onModules={clear} onRoute={open} onStage={(stage) => open({ ...route, stage })} onSignOut={signOut} permissionCodes={permissionCodes} isOwner={activeCompanyIsOwner} migrationReviewLocked={activeCompanyMigrationReviewLocked} />
      : <ModuleLauncher language={language} palette={palette} onPalette={setPalette} onLanguage={toggleLanguage} onOpen={open} onSignOut={signOut} permissionCodes={permissionCodes} />}
  </>;
}
