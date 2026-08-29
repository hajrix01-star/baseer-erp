import { lazy, Suspense, type ReactNode, useEffect, useState } from "react";
import { BaseerBrand } from "./baseer-brand";

const BaseerNavigationDrawer = lazy(async () => ({ default: (await import("./baseer-navigation-drawer")).BaseerNavigationDrawer }));

type Props = {
  header: ReactNode;
  moduleTitle: string;
  currentModuleLabel: string;
  sectionTitle: string;
  sectionsLabel: string;
  closeLabel: string;
  breadcrumbPrefix?: string;
  pageClassName?: string;
  onModules: () => void;
  navigation?: ReactNode;
  navigationKey?: string;
  children: ReactNode;
};

/**
 * Authenticated module frame. The frame makes every full workspace share one
 * heading, sidebar and mobile drawer contract while allowing focused flows to
 * omit navigation deliberately.
 */
export function BaseerAppShell({ header, moduleTitle, currentModuleLabel, sectionTitle, sectionsLabel, closeLabel, breadcrumbPrefix = "Baseer ERP", pageClassName, onModules, navigation, navigationKey, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hasNavigation = Boolean(navigation);
  const closeDrawer = () => setDrawerOpen(false);
  useEffect(() => { setDrawerOpen(false); }, [navigationKey]);
  return <>
    {header}
    <main className="workspace">
      {hasNavigation ? <aside className="module-sidebar"><div className="sidebar-product"><button className="sidebar-brand brand-button" style={{ transform: "translateY(11px)" }} onClick={onModules} type="button"><BaseerBrand /></button></div><div className="sidebar-head"><p className="overline">{currentModuleLabel}</p><h2>{moduleTitle}</h2></div>{navigation}</aside> : null}
      <section className={["module-page", pageClassName].filter(Boolean).join(" ")}>
        <div className="page-breadcrumb">{breadcrumbPrefix} / {moduleTitle}</div>
        <div className="page-heading"><div><h1>{sectionTitle}</h1></div>{hasNavigation ? <div className="page-actions"><button className="mobile-sections" type="button" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog" aria-expanded={drawerOpen}>☰ {sectionsLabel}</button></div> : null}</div>
        {children}
      </section>
    </main>
    {hasNavigation ? <Suspense fallback={null}><BaseerNavigationDrawer open={drawerOpen} title={moduleTitle} eyebrow={sectionsLabel} closeLabel={closeLabel} onClose={closeDrawer}>{navigation}</BaseerNavigationDrawer></Suspense> : null}
  </>;
}
