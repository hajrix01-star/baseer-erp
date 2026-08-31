import { useEffect, useState, type CSSProperties } from "react";
import "./baseer-theme-navigation.css";

import { BaseerModuleIcon } from "./baseer-module-icon";
import { BaseerSectionIcon } from "./baseer-section-icon";
import { canOpenRoute, visibleModules } from "./module-access";
import { getPage, pagesForModule, type PageId } from "./page-registry";
import { getModule, type ModuleId } from "./modules";

export type ThemeNavigationMode = "tree" | "modules";

type Language = "ar" | "en";
type ResolvedRoute = { moduleId: ModuleId; section: number; pageId: PageId; stage?: string };

type Props = {
  active: ResolvedRoute;
  language: Language;
  mode: ThemeNavigationMode;
  /**
   * Stable workflow stages belong to the page workspace. Some presentations
   * keep them as a secondary sidebar shortcut; compact tree navigation does
   * not, to avoid duplicating the page's own tabs.
   */
  showPageStages?: boolean;
  permissionCodes: readonly string[] | null;
  onSelect: (route: ResolvedRoute) => void;
  onStage: (stage: string) => void;
};

type PageStageTab = {
  id: string;
  label: Record<Language, string>;
  /** A stage is not visible unless the active page's documented permissions cover it. */
  isAllowed?: (permissionCodes: readonly string[] | null) => boolean;
};

const copy = {
  ar: {
    tree: "شجرة الموديولات والأقسام",
    modules: "الموديولات والأقسام",
    sections: "قسم",
  },
  en: {
    tree: "Modules and sections tree",
    modules: "Modules and sections",
    sections: "sections",
  },
} as const;

const has = (permissionCodes: readonly string[] | null, code: string) => permissionCodes?.includes(code) ?? false;

/**
 * These are the only stable URL stages that are already accepted by
 * WorkspacePageContent. Dialog/deep-link stages (for example an employee ID)
 * are intentionally excluded: they are actions, not navigable page tabs.
 */
const pageStageTabs: Partial<Record<PageId, readonly PageStageTab[]>> = {
  "reports-financial": [
    { id: "trial-balance", label: { ar: "ميزان المراجعة", en: "Trial balance" } },
    { id: "cash-performance", label: { ar: "الربح والخسارة المالي", en: "Financial profit and loss" } },
  ],
  "operations-purchases": [
    { id: "entry", label: { ar: "إدخال", en: "Entry" }, isAllowed: (codes) => has(codes, "finance.purchase_expense.create") },
    { id: "history", label: { ar: "سجل الفواتير", en: "Invoice history" }, isAllowed: (codes) => has(codes, "finance.purchase_expense.read") },
    { id: "credit", label: { ar: "الآجل", en: "Credit" }, isAllowed: (codes) => has(codes, "finance.purchase_expense.read") },
  ],
  "operations-expenses-obligations": [
    { id: "items", label: { ar: "البنود والالتزامات", en: "Items & obligations" }, isAllowed: (codes) => has(codes, "finance.configuration.read") && has(codes, "finance.loans.read") && has(codes, "finance.purchase_expense.read") },
    { id: "batch", label: { ar: "التسوية الجماعية", en: "Batch payment" }, isAllowed: (codes) => has(codes, "finance.configuration.read") && has(codes, "finance.purchase_expense.read") },
    { id: "history", label: { ar: "سجل التسويات", en: "Settlement history" }, isAllowed: (codes) => has(codes, "finance.loans.read") && has(codes, "finance.purchase_expense.read") },
  ],
};

/**
 * Theme navigation is deliberately derived from the immutable page registry
 * and current permission set. It is a visual replacement for the classic
 * sidebar only; it never creates routes or makes unavailable screens visible.
 */
function permittedRoutes(moduleId: ModuleId, permissionCodes: readonly string[] | null): ResolvedRoute[] {
  return [...pagesForModule(moduleId)]
    .sort((left, right) => left.navigation.order - right.navigation.order)
    .flatMap((page): ResolvedRoute[] => page.navigation.visible && canOpenRoute({ moduleId: page.moduleId, section: page.legacySection }, permissionCodes)
      ? [{ moduleId: page.moduleId, section: page.legacySection, pageId: page.id }]
      : []);
}

function PageStageTabs({ route, activeRoute, language, permissionCodes, onSelect, onStage }: { route: ResolvedRoute; activeRoute: ResolvedRoute; language: Language; permissionCodes: readonly string[] | null; onSelect: (route: ResolvedRoute) => void; onStage: (stage: string) => void }) {
  const tabs = (pageStageTabs[route.pageId] ?? []).filter((tab) => !tab.isAllowed || tab.isAllowed(permissionCodes));
  if (!tabs.length || route.pageId !== activeRoute.pageId) return null;
  const activeStage = activeRoute.stage ?? tabs[0].id;
  return <div className="theme-navigation__page-tabs" role="tablist" aria-label={getPage(route.pageId)?.title[language]}>
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeStage} className={tab.id === activeStage ? "is-active" : ""} onClick={() => {
      if (tab.id === tabs[0].id) onSelect({ moduleId: route.moduleId, section: route.section, pageId: route.pageId });
      else onStage(tab.id);
    }}>{tab.label[language]}</button>)}
  </div>;
}

function SectionLink({ route, active, activeRoute, language, showPageStages, permissionCodes, onSelect, onStage }: { route: ResolvedRoute; active: boolean; activeRoute: ResolvedRoute; language: Language; showPageStages: boolean; permissionCodes: readonly string[] | null; onSelect: (route: ResolvedRoute) => void; onStage: (stage: string) => void }) {
  const page = getPage(route.pageId);
  return <div className={`theme-navigation__section-branch${active ? " is-active" : ""}`}>
    <button
      className={`theme-navigation__section${active ? " is-active" : ""}`}
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(route)}
    >
      <BaseerSectionIcon glyph={page?.icon ?? "dashboard"} />
      <span>{page?.title[language]}</span>
    </button>
    {active && showPageStages ? <PageStageTabs route={route} activeRoute={activeRoute} language={language} permissionCodes={permissionCodes} onSelect={onSelect} onStage={onStage} /> : null}
  </div>;
}

function ModuleSymbol({ moduleId }: { moduleId: ModuleId }) {
  return <span className="theme-navigation__module-symbol" aria-hidden="true"><BaseerModuleIcon moduleId={moduleId} /></span>;
}

export function ThemeNavigation({ active, language, mode, showPageStages = true, permissionCodes, onSelect, onStage }: Props) {
  const text = copy[language];
  const availableModules = visibleModules(permissionCodes);
  const availableModuleKey = availableModules.map((module) => module.id).join(",");
  // The reference tree is a compact drill-in navigation: it opens the active
  // module only, so the user can scan one meaningful branch without a tall,
  // permanently expanded stack. B keeps its own expansion state as cards.
  const [expandedTree, setExpandedTree] = useState<ReadonlySet<ModuleId>>(() => new Set([active.moduleId]));
  const [expandedCards, setExpandedCards] = useState<ReadonlySet<ModuleId>>(() => new Set([active.moduleId]));

  useEffect(() => {
    if (mode === "tree") {
      setExpandedTree(new Set([active.moduleId]));
      return;
    }
    setExpandedCards((current) => current.has(active.moduleId) ? current : new Set([...current, active.moduleId]));
  }, [active.moduleId, availableModuleKey, mode]);

  const toggleCard = (moduleId: ModuleId) => {
    setExpandedCards((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  return <nav className={`theme-navigation theme-navigation--${mode}`} aria-label={mode === "tree" ? text.tree : text.modules}>
    {availableModules.map((module) => {
      const routes = permittedRoutes(module.id, permissionCodes);
      const isCurrentModule = module.id === active.moduleId;
      const isExpanded = mode === "tree" ? expandedTree.has(module.id) : expandedCards.has(module.id);
      const moduleTitle = (module.launcherTitle ?? module.title)[language];
      const moduleStyle = { "--theme-navigation-module": module.accent, "--theme-navigation-module-alt": module.accentAlt } as CSSProperties;

      if (mode === "tree") {
        return <details key={module.id} className={`theme-navigation__tree-node${isCurrentModule ? " is-current-module" : ""}`} data-module-id={module.id} open={isExpanded} style={moduleStyle}>
          <summary onClick={(event) => {
            // `details` fires toggle events for controlled open changes while
            // React is reconciling a new route.  Owning the click instead
            // keeps the reference rule stable: one deliberate branch open,
            // always the active branch after a route change.
            event.preventDefault();
            setExpandedTree((current) => current.has(module.id) ? new Set() : new Set([module.id]));
          }}>
            <ModuleSymbol moduleId={module.id} />
            <span className="theme-navigation__module-title">{moduleTitle}</span>
            <span className="theme-navigation__count">{routes.length}</span>
          </summary>
          <div className="theme-navigation__branches">
            {routes.map((route) => <SectionLink key={route.pageId} route={route} active={route.pageId === active.pageId} activeRoute={active} language={language} showPageStages={showPageStages} permissionCodes={permissionCodes} onSelect={onSelect} onStage={onStage} />)}
          </div>
        </details>;
      }

      return <section key={module.id} className={`theme-navigation__module-card${isCurrentModule ? " is-current-module" : ""}${isExpanded ? " is-expanded" : ""}`} data-module-id={module.id} style={moduleStyle}>
        <button className="theme-navigation__module-card-toggle" type="button" onClick={() => toggleCard(module.id)} aria-expanded={isExpanded} aria-controls={`theme-module-${module.id}`}>
          <ModuleSymbol moduleId={module.id} />
          <span><strong>{moduleTitle}</strong><small>{routes.length} {text.sections}</small></span>
          <span className="theme-navigation__disclosure" aria-hidden="true">⌄</span>
        </button>
        {isExpanded ? <div id={`theme-module-${module.id}`} className="theme-navigation__branches">
          {routes.map((route) => <SectionLink key={route.pageId} route={route} active={route.pageId === active.pageId} activeRoute={active} language={language} showPageStages={showPageStages} permissionCodes={permissionCodes} onSelect={onSelect} onStage={onStage} />)}
        </div> : null}
      </section>;
    })}
  </nav>;
}
