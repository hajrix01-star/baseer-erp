import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const registryPath = "docs/governance/UI_COMPONENT_REGISTRY.json";
const exceptionPath = "docs/governance/UI_EXCEPTION_REGISTER.json";
const componentLayers = new Set(["foundation", "primitive", "pattern", "domain-specialized"]);
const componentLifecycles = new Set(["planned", "pilot", "active", "retired"]);
const exceptionStatuses = new Set(["approved", "expired", "revoked"]);
const exceptionCategories = new Set(["domain-specialized", "semantic-native-control", "migration"]);
const idPattern = /^[a-z][a-z0-9-]*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireString(value, location, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${location} must be a non-empty string.`);
}

function requireStringArray(value, location, errors, { min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${location} must be an array of at least ${min} non-empty strings.`);
  }
}

function verifyProjectPath(path, location, errors) {
  if (typeof path !== "string" || !path.trim()) return;
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
    errors.push(`${location} must be a repository-relative slash-separated path.`);
    return;
  }
  if (!existsSync(resolve(root, path))) errors.push(`${location} points to a missing path: ${path}`);
}

function walkTypeScript(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory()
      ? walkTypeScript(path)
      : /\.(?:ts|tsx)$/.test(path) ? [path] : [];
  });
}

function importedProjectPaths(importer) {
  const source = readFileSync(importer, "utf8");
  const sourceFile = ts.createSourceFile(importer, source, ts.ScriptTarget.Latest, true, importer.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const paths = new Set();
  const recordSpecifier = (specifier) => {
    if (!specifier.startsWith(".")) return;
    const base = resolve(dirname(importer), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]) {
      if (existsSync(candidate)) {
        paths.add(candidate);
        break;
      }
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) recordSpecifier(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) recordSpecifier(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return paths;
}

const appSourceRoot = resolve(root, "apps/web/src");
const importEvidence = existsSync(appSourceRoot)
  ? new Map(walkTypeScript(appSourceRoot).map((path) => [path, importedProjectPaths(path)]))
  : new Map();

function validateHeader(document, path, collection, errors) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    errors.push(`${path} must contain a JSON object.`);
    return false;
  }
  if (document.schemaVersion !== 1) errors.push(`${path}.schemaVersion must equal 1.`);
  requireString(document.title, `${path}.title`, errors);
  requireString(document.authority, `${path}.authority`, errors);
  verifyProjectPath(document.authority, `${path}.authority`, errors);
  if (!datePattern.test(document.updatedAt ?? "")) errors.push(`${path}.updatedAt must be YYYY-MM-DD.`);
  if (!Array.isArray(document[collection])) {
    errors.push(`${path}.${collection} must be an array.`);
    return false;
  }
  return true;
}

const errors = [];
const registry = readJson(registryPath);
const exceptions = readJson(exceptionPath);

if (validateHeader(registry, registryPath, "components", errors)) {
  const ids = new Set();
  registry.components.forEach((component, index) => {
    const at = `${registryPath}.components[${index}]`;
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      errors.push(`${at} must be an object.`);
      return;
    }
    requireString(component.id, `${at}.id`, errors);
    if (typeof component.id === "string") {
      if (!idPattern.test(component.id)) errors.push(`${at}.id must be kebab-case.`);
      if (ids.has(component.id)) errors.push(`${at}.id duplicates ${component.id}.`);
      ids.add(component.id);
    }
    requireString(component.name, `${at}.name`, errors);
    if (!componentLayers.has(component.layer)) errors.push(`${at}.layer must be one of ${[...componentLayers].join(", ")}.`);
    if (!componentLifecycles.has(component.lifecycle)) errors.push(`${at}.lifecycle must be one of ${[...componentLifecycles].join(", ")}.`);
    requireString(component.owner, `${at}.owner`, errors);
    requireString(component.publicApi, `${at}.publicApi`, errors);
    requireStringArray(component.states, `${at}.states`, errors);
    requireStringArray(component.tests, `${at}.tests`, errors);
    requireStringArray(component.consumers, `${at}.consumers`, errors, { min: 0 });
    requireString(component.notes, `${at}.notes`, errors);
    if (component.lifecycle === "planned") {
      if (component.source !== null) errors.push(`${at}.source must be null while lifecycle is planned.`);
    } else {
      if (typeof component.source !== "string") errors.push(`${at}.source must be a source path unless lifecycle is planned.`);
      else verifyProjectPath(component.source, `${at}.source`, errors);
    }
    if (component.implementationSources !== undefined) {
      if (component.lifecycle === "planned") errors.push(`${at}.implementationSources is not valid while lifecycle is planned.`);
      requireStringArray(component.implementationSources, `${at}.implementationSources`, errors);
      if (Array.isArray(component.implementationSources)) component.implementationSources.forEach((path, sourceIndex) => verifyProjectPath(path, `${at}.implementationSources[${sourceIndex}]`, errors));
    }
    if (Array.isArray(component.consumers)) component.consumers.forEach((path, consumerIndex) => verifyProjectPath(path, `${at}.consumers[${consumerIndex}]`, errors));
    const testEvidence = component.testEvidence;
    if (testEvidence !== undefined) {
      if (!testEvidence || testEvidence.kind !== "playwright") errors.push(`${at}.testEvidence must be a Playwright evidence object.`);
      else {
        requireStringArray(testEvidence.paths, `${at}.testEvidence.paths`, errors);
        if (Array.isArray(testEvidence.paths)) testEvidence.paths.forEach((path, evidenceIndex) => {
          verifyProjectPath(path, `${at}.testEvidence.paths[${evidenceIndex}]`, errors);
          if (typeof path === "string" && !path.endsWith(".spec.ts")) errors.push(`${at}.testEvidence.paths[${evidenceIndex}] must be a Playwright .spec.ts file.`);
        });
      }
    }
    const usageEvidence = component.usageEvidence;
    if (usageEvidence !== undefined) {
      if (!usageEvidence || usageEvidence.kind !== "imports") {
        errors.push(`${at}.usageEvidence must be an import evidence object.`);
      } else if (typeof component.source !== "string" || !/\.(?:ts|tsx)$/.test(component.source)) {
        errors.push(`${at}.usageEvidence requires a TypeScript component source.`);
      } else {
        requireStringArray(usageEvidence.paths, `${at}.usageEvidence.paths`, errors);
        if (Array.isArray(usageEvidence.paths)) usageEvidence.paths.forEach((path, usageIndex) => {
          verifyProjectPath(path, `${at}.usageEvidence.paths[${usageIndex}]`, errors);
          if (typeof path !== "string" || !/\.(?:ts|tsx)$/.test(path)) {
            errors.push(`${at}.usageEvidence.paths[${usageIndex}] must be a TypeScript source file.`);
          } else if (importEvidence.get(resolve(root, path)) && !importEvidence.get(resolve(root, path)).has(resolve(root, component.source))) {
            errors.push(`${at}.usageEvidence.paths[${usageIndex}] does not import ${component.source}.`);
          }
        });
      }
    }
  });
}

if (validateHeader(exceptions, exceptionPath, "exceptions", errors)) {
  const ids = new Set();
  exceptions.exceptions.forEach((exception, index) => {
    const at = `${exceptionPath}.exceptions[${index}]`;
    if (!exception || typeof exception !== "object" || Array.isArray(exception)) {
      errors.push(`${at} must be an object.`);
      return;
    }
    requireString(exception.id, `${at}.id`, errors);
    if (typeof exception.id === "string") {
      if (!idPattern.test(exception.id)) errors.push(`${at}.id must be kebab-case.`);
      if (ids.has(exception.id)) errors.push(`${at}.id duplicates ${exception.id}.`);
      ids.add(exception.id);
    }
    if (!exceptionStatuses.has(exception.status)) errors.push(`${at}.status must be one of ${[...exceptionStatuses].join(", ")}.`);
    if (exception.status === "expired") errors.push(`${at} is expired and must be renewed, revoked, or removed.`);
    if (!exceptionCategories.has(exception.category)) errors.push(`${at}.category must be registered.`);
    requireString(exception.rationale, `${at}.rationale`, errors);
    requireString(exception.owner, `${at}.owner`, errors);
    requireStringArray(exception.evidence, `${at}.evidence`, errors);
    if (!datePattern.test(exception.createdAt ?? "")) errors.push(`${at}.createdAt must be YYYY-MM-DD.`);
    if (exception.p0Waiver !== false) errors.push(`${at}.p0Waiver must be false; P0 waivers are prohibited.`);
    const scope = exception.scope;
    if (!scope || scope.kind !== "source-paths" || !Array.isArray(scope.paths) || scope.paths.length === 0) {
      errors.push(`${at}.scope must name one or more source paths.`);
    } else {
      scope.paths.forEach((path, pathIndex) => verifyProjectPath(path, `${at}.scope.paths[${pathIndex}]`, errors));
    }
    const review = exception.review;
    if (!review || typeof review !== "object") {
      errors.push(`${at}.review must define a trigger and reviewBy.`);
    } else {
      requireString(review.trigger, `${at}.review.trigger`, errors);
      if (!datePattern.test(review.reviewBy ?? "")) errors.push(`${at}.review.reviewBy must be YYYY-MM-DD.`);
    }
    if (Array.isArray(exception.evidence)) exception.evidence.forEach((path, evidenceIndex) => verifyProjectPath(path, `${at}.evidence[${evidenceIndex}]`, errors));
  });
}

if (errors.length) {
  console.error("UI governance register validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`UI governance registers verified (${registry.components.length} components, ${exceptions.exceptions.length} approved exceptions).`);
}
