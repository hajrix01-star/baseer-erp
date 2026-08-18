import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = join(process.cwd(), "apps", "web", "src");
const dialogFiles = [];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile() && file.endsWith(".tsx")) dialogFiles.push(file);
  }
}
visit(sourceRoot);

const duplicateDismissal = />\s*(?:إغلاق|إلغاء)\s*</u;
const failures = dialogFiles.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  if (!source.includes('role="dialog"') || !source.includes("dialog-icon-button")) return [];
  return duplicateDismissal.test(source) ? [file] : [];
});

const browserConfirmFiles = dialogFiles.filter((file) => readFileSync(file, "utf8").includes("window.confirm("));
if (browserConfirmFiles.length) {
  throw new Error(`Use BaseerConfirmDialog instead of browser confirm: ${browserConfirmFiles.join(", ")}`);
}
if (failures.length) {
  throw new Error(`Dialogs with a header close icon must not repeat a textual dismiss button: ${failures.join(", ")}`);
}

console.log("Dialog dismissal convention verified.");