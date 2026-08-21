import { useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { downloadBaseerOutput, openBaseerPrintWindow, printBaseerOutput, requestBaseerOutput } from "./baseer-output-client";
import { BaseerShareMenu } from "./baseer-share-menu";
import type { ActiveSession } from "./daily-sales-client";

/** Reusable actions for a server-defined report; never accepts screen data as input. */
export function BaseerOutputActions({ session, reportCode, language, filters = {}, printLabel, allowExport = true }: { session: ActiveSession; reportCode: string; language: "ar" | "en"; filters?: Record<string, string | number | boolean | null>; printLabel?: string; allowExport?: boolean }) {
  const [busy, setBusy] = useState<"preview" | "slips" | "xlsx" | null>(null);
  const [message, setMessage] = useState("");
  const print = async () => {
    let printWindow: Window | null = null;
    try { printWindow = openBaseerPrintWindow(); } catch (error) { setMessage(presentBaseerApiError(error, language, language === "ar" ? "سمح للمتصفح بفتح نافذة الطباعة ثم أعد المحاولة." : "Allow the print pop-up, then try again.")); return; }
    setBusy("preview"); setMessage("");
    try { const receipt = await requestBaseerOutput(session, reportCode, "preview", language, filters); await printBaseerOutput(session, receipt, printWindow); }
    catch (error) { printWindow.close(); setMessage(presentBaseerApiError(error, language, language === "ar" ? "تعذرت معاينة الطباعة." : "Could not preview the print document.")); }
    finally { setBusy(null); }
  };
  const exportXlsx = async () => {
    setBusy("xlsx"); setMessage("");
    try { downloadBaseerOutput(await requestBaseerOutput(session, reportCode, "xlsx", language, filters)); }
    catch (error) { setMessage(presentBaseerApiError(error, language, language === "ar" ? "تعذر تصدير الملف." : "Could not export the file.")); }
    finally { setBusy(null); }
  };
  const printSignatureSlips = async () => {
    let printWindow: Window | null = null;
    try { printWindow = openBaseerPrintWindow(); } catch (error) { setMessage(presentBaseerApiError(error, language, language === "ar" ? "سمح للمتصفح بفتح نافذة الطباعة ثم أعد المحاولة." : "Allow the print pop-up, then try again.")); return; }
    setBusy("slips"); setMessage("");
    try { const receipt = await requestBaseerOutput(session, "hr.payroll-signature-slips", "preview", language, filters); await printBaseerOutput(session, receipt, printWindow); }
    catch (error) { printWindow.close(); setMessage(presentBaseerApiError(error, language, language === "ar" ? "تعذرت معاينة كشوف التوقيع." : "Could not preview signature slips.")); }
    finally { setBusy(null); }
  };
  const share = language === "ar" ? "مشاركة" : "Share";
  return <BaseerShareMenu label={share} message={message}><button type="button" role="menuitem" disabled={busy !== null} onClick={() => void print()}>{busy === "preview" ? (language === "ar" ? "جارٍ تجهيز الطباعة…" : "Preparing print…") : (printLabel ?? (language === "ar" ? "طباعة" : "Print"))}</button>{reportCode === "hr.payroll-run" ? <button type="button" role="menuitem" disabled={busy !== null} onClick={() => void printSignatureSlips()}>{busy === "slips" ? (language === "ar" ? "جارٍ تجهيز الكشوف…" : "Preparing slips…") : (language === "ar" ? "كشوف التوقيع" : "Signature slips")}</button> : null}{allowExport ? <button type="button" role="menuitem" disabled={busy !== null} onClick={() => void exportXlsx()}>{busy === "xlsx" ? (language === "ar" ? "جارٍ التصدير…" : "Exporting…") : (language === "ar" ? "تصدير Excel" : "Export Excel")}</button> : null}</BaseerShareMenu>;
}
