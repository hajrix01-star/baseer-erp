import { BaseerButton } from "./baseer-button";

export function BaseerLoadFailure({
  message,
  language,
  onRetry,
  busy = false,
}: {
  message: string;
  language: "ar" | "en";
  onRetry: () => void;
  busy?: boolean;
}) {
  return (
    <div className="baseer-load-failure" role="alert">
      <p>{message}</p>
      <BaseerButton type="button" variant="secondary" disabled={busy} onClick={onRetry}>
        {language === "ar" ? "إعادة المحاولة" : "Retry"}
      </BaseerButton>
    </div>
  );
}
