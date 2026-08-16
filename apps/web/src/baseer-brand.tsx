type BaseerBrandProps = Readonly<{
  className?: string;
}>;

/**
 * Product wordmark. The ERP uses one clear text identity in the application
 * shell; the decorative symbol is intentionally omitted to avoid duplication.
 */
export function BaseerBrand({ className = "" }: BaseerBrandProps) {
  return (
    <span className={`baseer-brand ${className}`.trim()} dir="ltr" aria-label="Baseer ERP" role="img">
      <span className="baseer-brand__word">Baseer <b>ERP</b></span>
    </span>
  );
}
