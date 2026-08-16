type BaseerBrandProps = Readonly<{
  className?: string;
}>;

/** Shared product wordmark, sourced from the approved Baseer identity asset. */
export function BaseerBrand({ className = "" }: BaseerBrandProps) {
  return (
    <span className={`baseer-brand ${className}`.trim()} dir="ltr" aria-label="Baseer ERP" role="img">
      <img
        aria-hidden="true"
        alt=""
        className="baseer-brand__image"
        draggable={false}
        height={136}
        src="/brand/baseer-wordmark.png"
        width={547}
      />
      <span className="baseer-brand__erp">ERP</span>
    </span>
  );
}