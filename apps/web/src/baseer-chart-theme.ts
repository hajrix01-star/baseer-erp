import { useEffect, useMemo, useState } from "react";

export type BaseerChartPalette = Readonly<{
  primary: string;
  primarySoft: string;
  primaryDeep: string;
  secondary: string;
  danger: string;
  info: string;
  axis: string;
  grid: string;
  tooltip: string;
  tooltipInk: string;
  tooltipSurface: string;
  tooltipBorder: string;
  revision: number;
}>;

/**
 * This is an accessibility-safe last resort for an embedded chart whose host
 * has not loaded the token manifest yet. Modern presentations always provide
 * their own --chart-* variables, so this object never writes or overrides a
 * theme or a data palette.
 */
const fallback = {
  primary: "CanvasText",
  primarySoft: "Highlight",
  primaryDeep: "CanvasText",
  secondary: "Highlight",
  danger: "Mark",
  info: "Highlight",
  axis: "GrayText",
  grid: "ButtonBorder",
  tooltip: "CanvasText",
  tooltipInk: "Canvas",
  tooltipSurface: "Canvas",
  tooltipBorder: "ButtonBorder",
} as const;

function value(styles: CSSStyleDeclaration, chartToken: string, semanticToken: string, fallbackValue: string) {
  return styles.getPropertyValue(chartToken).trim()
    || styles.getPropertyValue(semanticToken).trim()
    || fallbackValue;
}

/**
 * Resolve the palette from computed CSS rather than a component-local color
 * list.  The chart variables are the presentation contract; semantic roles
 * make the fallback useful for isolated/embedded workspace roots.  This is a
 * read-only operation, which prevents a legacy fallback from leaking into a
 * Modern 1 or Modern 2 presentation.
 */
export function readBaseerChartPalette(styles: CSSStyleDeclaration, revision = 0): BaseerChartPalette {
  return {
    primary: value(styles, "--chart-primary", "--brand", fallback.primary),
    primarySoft: value(styles, "--chart-primary-soft", "--brand", fallback.primarySoft),
    primaryDeep: value(styles, "--chart-primary-deep", "--brand-deep", fallback.primaryDeep),
    secondary: value(styles, "--chart-secondary", "--status-warning", fallback.secondary),
    danger: value(styles, "--chart-danger", "--status-danger", fallback.danger),
    info: value(styles, "--chart-info", "--status-info", fallback.info),
    axis: value(styles, "--chart-axis", "--muted", fallback.axis),
    grid: value(styles, "--chart-grid", "--line", fallback.grid),
    tooltip: value(styles, "--chart-tooltip", "--ink", fallback.tooltip),
    tooltipInk: value(styles, "--chart-tooltip-ink", "--on-brand", fallback.tooltipInk),
    tooltipSurface: value(styles, "--chart-tooltip-surface", "--surface", fallback.tooltipSurface),
    tooltipBorder: value(styles, "--chart-tooltip-border", "--line", fallback.tooltipBorder),
    revision,
  };
}

/** Canvas charts cannot inherit CSS by themselves, so their drawing palette
 * reads the same semantic variables as cards and tables. */
export function useBaseerChartPalette(): BaseerChartPalette {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    window.addEventListener("baseer-ui-theme-change", refresh);
    return () => window.removeEventListener("baseer-ui-theme-change", refresh);
  }, []);
  return useMemo(() => {
    return readBaseerChartPalette(getComputedStyle(document.body), revision);
  }, [revision]);
}

/** Converts a caller-provided chart data colour into an alpha value. The
 * notation strings below parse chart output; they are not UI palette values. */
export function chartAlpha(color: string, opacity: number): string {
  const hex = color.trim().replace("#", "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const expanded = hex.split("").map((channel) => `${channel}${channel}`).join("");
    return chartAlpha(`#${expanded}`, opacity);
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const numeric = Number.parseInt(hex, 16);
    return `rgba(${numeric >> 16}, ${(numeric >> 8) & 255}, ${numeric & 255}, ${opacity})`;
  }
  const rgb = color.trim().match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/i);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity})`;
  return color;
}
