import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const distDirectory = resolve("apps/web/dist");
const indexPath = resolve(distDirectory, "index.html");
const expectedPrefix = "/baseer-static/";

if (!existsSync(indexPath)) {
  throw new Error("Web production build is missing apps/web/dist/index.html.");
}

const indexHtml = readFileSync(indexPath, "utf8");
const resourcePaths = [...indexHtml.matchAll(/(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g)]
  .map((match) => match[1])
  .filter((path) => path.endsWith(".js") || path.endsWith(".css"));

if (!resourcePaths.length) {
  throw new Error("Web production shell does not reference a JavaScript or CSS resource.");
}

const unexpectedPaths = resourcePaths.filter((path) => !path.startsWith(expectedPrefix));
if (unexpectedPaths.length) {
  throw new Error(
    `Web production resources must use ${expectedPrefix}, found: ${unexpectedPaths.join(", ")}`,
  );
}

const missingPaths = resourcePaths.filter((path) => !existsSync(resolve(distDirectory, `.${path}`)));
if (missingPaths.length) {
  throw new Error(`Web production resources are missing from dist: ${missingPaths.join(", ")}`);
}

process.stdout.write(
  `Web static route check passed: ${resourcePaths.length} resource(s) use ${expectedPrefix}.\n`,
);
