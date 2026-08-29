import { openBaseerPrintWindow } from "./baseer-output-client";
import { formatDateTime } from "./number-format";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

/** Shared client-side output for visual charts. The source is the rendered
 * chart canvas, so exported values always match what the user is viewing. */
export function downloadBaseerChartPng(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.click();
}

export function printBaseerChartImage({ dataUrl, title, language }: { dataUrl: string; title: string; language: "ar" | "en" }) {
  const printWindow = openBaseerPrintWindow();
  const direction = language === "ar" ? "rtl" : "ltr";
  const generatedAt = formatDateTime(new Date(), language, "Asia/Riyadh");
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="${language}" dir="${direction}"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>@page{size:landscape;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#173d32;background:#fff;font-family:Arial,sans-serif}header{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;padding-bottom:10mm;border-bottom:1px solid #d9c4a3}h1{margin:0;font-size:20pt}p{margin:0;color:#6f7168;font-size:9pt}.chart{padding-top:8mm}.chart img{display:block;width:100%;height:auto}footer{margin-top:7mm;padding-top:4mm;border-top:1px solid #e5ddd0;color:#6f7168;font-size:8pt}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><header><div><h1>${escapeHtml(title)}</h1><p>${language === "ar" ? "تصدير بصري من بصيرة" : "Baseer visual chart export"}</p></div><p>${escapeHtml(generatedAt)}</p></header><main class="chart"><img src="${dataUrl}" alt="${escapeHtml(title)}" /></main><footer>${language === "ar" ? "صورة الرسم تعكس حالة العرض عند وقت الطباعة." : "The chart image reflects the view at the time of printing."}</footer><script>addEventListener('load',()=>{focus();print()})</script></body></html>`);
  printWindow.document.close();
}
