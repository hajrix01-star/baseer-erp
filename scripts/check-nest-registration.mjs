import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(repositoryRoot, 'apps', 'api', 'src');
const appModulePath = join(sourceRoot, 'app.module.ts');

function listTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && extname(entry.name) === '.ts' && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

function extractArrayProperty(source, propertyName) {
  const property = new RegExp(`\\b${propertyName}\\s*:`).exec(source);
  if (!property) throw new Error(`Could not find the @Module ${propertyName} property in ${appModulePath}.`);

  const start = source.indexOf('[', property.index + property[0].length);
  if (start === -1) throw new Error(`Could not find the @Module ${propertyName} array in ${appModulePath}.`);

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '[') depth += 1;
    if (source[index] === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }

  throw new Error(`The @Module ${propertyName} array is not closed in ${appModulePath}.`);
}

function extractControllerClasses(source) {
  const controllerClasses = [];
  const pattern = /@Controller\b[\s\S]{0,2000}?\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(pattern)) controllerClasses.push(match[1]);
  return controllerClasses;
}

function resolveImportPath(specifier) {
  if (!specifier.startsWith('.')) return null;
  const candidate = resolve(sourceRoot, specifier.replace(/\.js$/, '.ts'));
  return existsSync(candidate) ? candidate : null;
}

function extractNamedImports(source) {
  const imports = [];
  const pattern = /import\s*{([\s\S]*?)}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const path = resolveImportPath(match[2]);
    if (!path) continue;
    for (const specifier of match[1].split(',')) {
      const named = specifier.trim();
      if (!named) continue;
      const alias = named.split(/\s+as\s+/);
      imports.push({ exported: alias[0].trim(), local: (alias[1] ?? alias[0]).trim(), path });
    }
  }
  return imports;
}

try {
  const appModuleSource = readFileSync(appModulePath, 'utf8');
  const registeredControllers = new Set(
    (extractArrayProperty(appModuleSource, 'controllers').match(/[A-Za-z_$][\w$]*/g) ?? []),
  );
  const imports = extractNamedImports(appModuleSource);
  const decoratedControllers = listTypeScriptFiles(sourceRoot).flatMap((path) =>
    extractControllerClasses(readFileSync(path, 'utf8')).map((name) => ({ name, path })),
  );

  const failures = decoratedControllers
    .filter(({ name, path }) => !imports.some((item) =>
      item.path === path && item.exported === name && registeredControllers.has(item.local),
    ))
    .map(({ name, path }) => `${name} (${relative(repositoryRoot, path)})`);

  const warnings = [...registeredControllers].flatMap((name) => {
    const imported = imports.find((item) => item.local === name);
    if (!imported || !imported.path.endsWith('.controller.ts')) return [];
    const exportedControllers = extractControllerClasses(readFileSync(imported.path, 'utf8'));
    return exportedControllers.includes(imported.exported)
      ? []
      : [`${name} is registered as a controller, but ${relative(repositoryRoot, imported.path)} has no matching @Controller-decorated export.`];
  });

  if (warnings.length) console.warn(`WARNING: Nest controller registration check:\n- ${warnings.join('\n- ')}`);
  if (failures.length) {
    console.error(`FAIL: @Controller classes missing from AppModule.controllers:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }

  console.log(`PASS: ${decoratedControllers.length} @Controller classes are registered in AppModule.controllers.`);
} catch (error) {
  console.error(`FAIL: Nest controller registration check could not complete: ${error.message}`);
  process.exit(1);
}
