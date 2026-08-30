import { readFileSync } from "node:fs";

const signIn = readFileSync("apps/web/src/daily-sales-sign-in.tsx", "utf8");
const workspace = readFileSync("apps/web/src/daily-sales-workspace.tsx", "utf8");
const reversal = readFileSync("apps/web/src/daily-sales-reversal-dialog.tsx", "utf8");
const copy = readFileSync("apps/web/src/daily-sales-copy.ts", "utf8");
const client = readFileSync("apps/web/src/daily-sales-client.ts", "utf8");
const purchase = readFileSync("apps/web/src/purchase-expense-workspace-runtime.tsx", "utf8");
const financeSources = [
  "apps/web/src/daily-sales-closing-dialog.tsx",
  "apps/web/src/expenses-obligations-workspace.tsx",
  "apps/web/src/finance-accounts-workspace.tsx",
  "apps/web/src/purchase-expense-credit-panel.tsx",
  "apps/web/src/purchase-expense-workspace.tsx",
  "apps/web/src/recurring-expense-workspace.tsx",
  "apps/web/src/treasury-workspace.tsx",
].map((file) => [file, readFileSync(file, "utf8")]);
const centralFinancialSources = [
  "apps/web/src/command-center-workspace-runtime.tsx",
  "apps/web/src/command-center-weekly-sales-card.tsx",
  "apps/web/src/sales-analytics-workspace.tsx",
  "apps/web/src/monthly-application-sales-share-chart.tsx",
  "apps/web/src/owner-daily-brief-workspace-runtime.tsx",
  "apps/web/src/owner-financial-movement-workspace.tsx",
  "apps/web/src/operations-overview-workspace.tsx",
  "apps/web/src/baseer-chart.tsx",
].map((file) => [file, readFileSync(file, "utf8")]);
if (/\bfetch\(/.test(signIn) || /\bfetch\(/.test(workspace)) {
  throw new Error("Screen components must use a typed adapter, not fetch directly.");
}
if (/window\.prompt/.test(workspace)) {
  throw new Error("Financial reversal must use the confirmed dialog, never window.prompt.");
}
const reversalUsesFocusedDialog = reversal.includes("useDialogFocusTrap") || (reversal.includes("BaseerDialog") && reversal.includes("busy={saving}"));
if (!reversalUsesFocusedDialog || !copy.includes("reverseConfirm")) {
  throw new Error("Reversal dialog must preserve focus behavior and explicit confirmation.");
}
if (!client.includes("parseBaseerApiResponse")) {
  throw new Error("API client must parse the standard Baseer error receipt.");
}
if (!purchase.includes("async (query: string, signal: AbortSignal)") || !purchase.includes('async (kind: BatchRow["kind"], query: string, signal: AbortSignal)') || (purchase.match(/\{ signal \}/g) ?? []).length < 2) {
  throw new Error("Remote financial selectors must forward AbortSignal to both supplier and category requests.");
}
const moneyNumberPattern = /Number\([^\n)]*(?:amount|balance|debit|credit|gross|net|vat|allocation|outstanding)/i;
for (const [file, source] of financeSources) {
  if (moneyNumberPattern.test(source)) throw new Error(`${file} must not coerce money to JavaScript Number.`);
}
const centralMoneyComputation = /(?:Number|parseFloat|parseInt)\([^\n)]*\.(?:amount|sales|gross|net|vat|spend|purchase|inflow|outflow|balance|cash)/i;
const centralMoneyReduction = /\.reduce\([^\n]*(?:amount|sales|gross|net|vat|spend|purchase|inflow|outflow|balance|cash)/i;
for (const [file, source] of centralFinancialSources) {
  if (centralMoneyComputation.test(source) || centralMoneyReduction.test(source)) {
    throw new Error(`${file} must render central financial read-model values without browser money aggregation.`);
  }
}
console.log("Web financial boundaries verified.");
