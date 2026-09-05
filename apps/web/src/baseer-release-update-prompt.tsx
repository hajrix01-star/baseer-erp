import { useEffect, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import type { BaseerLanguage } from "./baseer-ui-copy";

const releaseMetaName = "baseer-release-id";
const checkEveryMs = 60_000;

function currentReleaseId() {
  return document.querySelector<HTMLMetaElement>(`meta[name="${releaseMetaName}"]`)?.content ?? "";
}

function releaseIdFromHtml(html: string) {
  return new DOMParser().parseFromString(html, "text/html")
    .querySelector<HTMLMetaElement>(`meta[name="${releaseMetaName}"]`)?.content ?? "";
}

/**
 * Global, non-destructive update notice.  It deliberately checks the deployed
 * HTML instead of an authenticated API so every route has the same release
 * signal and an unfinished financial form is never reloaded automatically.
 */
export function BaseerReleaseUpdatePrompt() {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<BaseerLanguage>(() => document.documentElement.lang.startsWith("en") ? "en" : "ar");

  useEffect(() => {
    const observer = new MutationObserver(() => setLanguage(document.documentElement.lang.startsWith("en") ? "en" : "ar"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const loadedRelease = currentReleaseId();
    if (!loadedRelease || loadedRelease === "development") return;
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`/?baseer-release-check=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok || !active) return;
        const deployedRelease = releaseIdFromHtml(await response.text());
        if (active && deployedRelease && deployedRelease !== loadedRelease) setOpen(true);
      } catch {
        // Update detection is advisory; an offline or failing network must not
        // disrupt the active ERP task.
      }
    };
    const timer = window.setInterval(() => void check(), checkEveryMs);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const copy = language === "ar"
    ? { title: "يتوفر تحديث جديد", body: "نُشر إصدار أحدث من بصير. حدّث الصفحة بعد حفظ عملك الحالي.", reload: "تحديث الصفحة", later: "لاحقًا" }
    : { title: "An update is ready", body: "A newer Baseer release is available. Save your current work, then refresh the page.", reload: "Refresh page", later: "Later" };
  return <BaseerDialog
    open={open}
    title={copy.title}
    language={language}
    onClose={() => setOpen(false)}
    footer={<><BaseerButton type="button" variant="secondary" onClick={() => setOpen(false)}>{copy.later}</BaseerButton><BaseerButton type="button" onClick={() => window.location.reload()}>{copy.reload}</BaseerButton></>}
  >
    <p>{copy.body}</p>
  </BaseerDialog>;
}
