import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = join(process.cwd(), "apps", "web", "src");
const copyFiles = ["app-copy.ts", "baseer-ui-copy.ts", "administration-copy.ts", "daily-sales-copy.ts", "finance-copy.ts"];
const arabic = /[\u0600-\u06ff]/u;
const visibleAttributeNames = new Set(["aria-label", "placeholder", "title", "alt"]);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

const failures = [];
for (const copyFile of copyFiles) {
  const source = readFileSync(join(root, copyFile), "utf8");
  if (!source.includes("defineLocalizedCopy")) failures.push(`${copyFile}: must use defineLocalizedCopy().`);
}
for (const file of files(root).filter((candidate) => candidate.endsWith(".tsx"))) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const report = (node, message) => {
    const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    failures.push(`${file}:${line + 1}:${character + 1}: ${message}`);
  };
  const visit = (node) => {
    if (ts.isJsxText(node) && arabic.test(node.text)) {
      report(node, "visible Arabic JSX text must come from a copy dictionary.");
    }
    if (ts.isJsxAttribute(node) && visibleAttributeNames.has(node.name.text) && node.initializer) {
      const value = ts.isStringLiteral(node.initializer)
        ? node.initializer.text
        : ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isStringLiteral(node.initializer.expression)
          ? node.initializer.expression.text
          : null;
      if (value && arabic.test(value)) report(node, "visible Arabic JSX attributes must come from a copy dictionary.");
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
if (failures.length) {
  console.error("Web localization guard failed:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(`Web localization guard passed: ${copyFiles.length} typed dictionaries and no direct visible Arabic JSX literals.`);
