import { readFileSync } from "node:fs";

const signIn = readFileSync("apps/web/src/daily-sales-sign-in.tsx", "utf8");
const workspace = readFileSync("apps/web/src/daily-sales-workspace.tsx", "utf8");
const reversal = readFileSync("apps/web/src/daily-sales-reversal-dialog.tsx", "utf8");
const copy = readFileSync("apps/web/src/daily-sales-copy.ts", "utf8");
const client = readFileSync("apps/web/src/daily-sales-client.ts", "utf8");
if (/\bfetch\(/.test(signIn) || /\bfetch\(/.test(workspace)) {
  throw new Error("Screen components must use a typed adapter, not fetch directly.");
}
if (/window\.prompt/.test(workspace)) {
  throw new Error("Financial reversal must use the confirmed dialog, never window.prompt.");
}
if (!reversal.includes("useDialogFocusTrap") || !copy.includes("reverseConfirm")) {
  throw new Error("Reversal dialog must preserve focus behavior and explicit confirmation.");
}
if (!client.includes("parseBaseerApiResponse")) {
  throw new Error("API client must parse the standard Baseer error receipt.");
}
console.log("Web financial boundaries verified.");