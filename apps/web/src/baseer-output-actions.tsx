import { useState } from "react";

import { BaseerButton } from "./baseer-button";
import { presentBaseerApiError } from "./baseer-api-error";
import { downloadBaseerOutput, openBaseerPrintWindow, printBaseerOutput, requestBaseerOutput } from "./baseer-output-client";
import type { ActiveSession } from "./daily-sales-client";

/** Reusable actions for a server-defined report; never accepts screen data as input. */
export function BaseerOutputActions({ session, reportCode, language }: { session: ActiveSession; reportCode: string; language: "ar" | "en" }) {
  const [busy, setBusy] = useState<"preview" | "xlsx" | null>(null);
  const [message, setMessage] = useState("");
  const print = async () => {
    let printWindow: Window | null = null;
    try { printWindow = openBaseerPrintWindow(); } catch (error) { setMessage(presentBaseerApiError(error, language, language === "ar" ? "سمح للمتصفح بفتح نافذة الطباعة ثم أعد المحاولة." : "Allow the print pop-up, then try again.")); return; }
    setBusy("preview"); setMessage("");
    try { const receipt = await requestBaseerOutput(session, reportCode, "preview", language); await printBaseerOutput(session, receipt, printWindow); }
    catch (error) { printWindow.close(); setMessage(presentBaseerApiError(error, language, language === "ar" ? "تعذرت معاينة الطباعة." : "Could not preview the print document.")); }
    finally { setBusy(null); }
  };
  const exportXlsx = async () => {
    setBusy("xlsx"); setMessage("");
    try { downloadBaseerOutput(await requestBaseerOutput(session, reportCode, "xlsx", language)); }
    catch (error) { setMessage(presentBaseerApiError(error, language, language === "ar" ? "تعذر تصدير الملف." : "Could not export the file.")); }
    finally { setBusy(null); }
  };
  return <div><div className="page-actions"><BaseerButton type="button" onClick={() => void print()} disabled={busy !== null}>{busy === "preview" ? (language === "ar" ? "جارٍ تجهيز الطباعة…" : "Preparing print…") : (language === "ar" ? "طباعة" : "Print")}</BaseerButton><BaseerButton type="button" variant="secondary" onClick={() => void exportXlsx()} disabled={busy !== null}>{busy === "xlsx" ? (language === "ar" ? "جارٍ التصدير…" : "Exporting…") : (language === "ar" ? "تصدير Excel" : "Export Excel")}</BaseerButton></div>{message && <p className="daily-sales-message error">{message}</p>}</div>;
}