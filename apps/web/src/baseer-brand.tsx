type BaseerBrandProps = Readonly<{
  compact?: boolean;
  className?: string;
}>;

/**
 * BASEER product mark, adapted from the approved Baseer social application.
 * The SVG is intentionally local so the ERP shell has no remote branding
 * dependency and works while disconnected.
 */
export function BaseerBrand({ compact = false, className = "" }: BaseerBrandProps) {
  return <span className={`baseer-brand ${className}`.trim()} dir="ltr" aria-label="Baseer ERP" role="img">
    <svg aria-hidden="true" viewBox="0 0 64 78" className="baseer-brand__mark">
      <path fill="currentColor" fillRule="evenodd" d="M5 3h27c15.5 0 24.5 7.6 24.5 19.8 0 7-3.4 12.4-9.3 15.5C54.5 41.4 59 47.3 59 55c0 12.8-9.8 20-27.2 20H5V3Zm14 12.5v18.8h11.5c8.1 0 12.5-3.4 12.5-9.5s-4.4-9.3-12.5-9.3H19Zm0 30.7v16.3h13.2c8.7 0 13.2-2.7 13.2-8.2 0-5.4-4.5-8.1-13.2-8.1H19Z" />
      <path fill="#d6ae62" d="M5 75 17.8 59.4h7L12 75H5Z" />
    </svg>
    {!compact && <span className="baseer-brand__word">Baseer <b>ERP</b></span>}
  </span>;
}
