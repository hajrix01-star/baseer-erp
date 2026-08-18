import { api, requestId, type ActiveSession } from "./daily-sales-client";

export type BaseerOutputFormat = "preview" | "xlsx";
type OutputReceipt = {
  idempotencyReceiptId: string;
  snapshotId: string;
  reportCode: string;
  format: BaseerOutputFormat;
  mimeType: string;
  fileName: string | null;
  contentEncoding: "utf8" | "base64";
  content: string;
};

/** Uses a server-built snapshot; it never prints the interactive application shell. */
export async function requestBaseerOutput(
  session: ActiveSession,
  reportCode: string,
  format: BaseerOutputFormat,
  locale: "ar" | "en",
  filters: Record<string, string | number | boolean | null> = {},
): Promise<OutputReceipt> {
  return api<OutputReceipt>(session, `/outputs/${reportCode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId() },
    body: JSON.stringify({ format, locale, filters, idempotencyKey: requestId() }),
  });
}

export function openBaseerPrintWindow(): Window {
  const printWindow = window.open("", "_blank", "popup");
  if (!printWindow) throw new Error("Pop-up was blocked. Allow printing for Baseer ERP and try again.");
  printWindow.opener = null;
  return printWindow;
}

export async function printBaseerOutput(session: ActiveSession, receipt: OutputReceipt, printWindow: Window): Promise<void> {
  if (receipt.format !== "preview" || receipt.contentEncoding !== "utf8") throw new Error("This output is not a print preview.");
  printWindow.document.open();
  printWindow.document.write(receipt.content);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  await api<void>(session, "/outputs/print-issued", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId() },
    body: JSON.stringify({ idempotencyReceiptId: receipt.idempotencyReceiptId }),
  });
}

export function downloadBaseerOutput(receipt: OutputReceipt): void {
  if (receipt.format !== "xlsx" || receipt.contentEncoding !== "base64" || !receipt.fileName) throw new Error("This output is not an Excel export.");
  const binary = atob(receipt.content);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const href = URL.createObjectURL(new Blob([bytes], { type: receipt.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = receipt.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}