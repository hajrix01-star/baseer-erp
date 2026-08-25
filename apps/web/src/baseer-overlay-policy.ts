/**
 * Portal overlays must use this scale rather than local numeric z-index values.
 *
 * Every application overlay belongs to one of these named layers. Local
 * stacking for cards, tables and decorative elements is deliberately outside
 * this scale: it must never compete with a portal overlay.
 */
export const BASEER_OVERLAY_LAYER = {
  base: 0,
  sticky: 100,
  portalPopover: 1400,
  navigationDrawer: 1500,
  modal: 1600,
  toast: 1700,
} as const;
