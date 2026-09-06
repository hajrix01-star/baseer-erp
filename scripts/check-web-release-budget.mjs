import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = "apps/web/dist";
const assets = join(dist, "assets");
const manifestPath = join(dist, ".vite", "manifest.json");

if (!existsSync(manifestPath)) throw new Error("Web build manifest is missing. Run the production build before the budget check.");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// Release budgets model bytes transferred over the wire. Vite prints source
// bytes as useful diagnostics, but Caddy serves compressed assets and users
// do not download the uncompressed file size. Keep the metric deterministic
// by calculating gzip locally for every asset rather than trusting a host.
const transferSizeFor = (file) => gzipSync(readFileSync(join(dist, file))).byteLength;
const files = readdirSync(assets).map((name) => ({ name, size: transferSizeFor(join("assets", name)) }));
const sizeFor = (file) => transferSizeFor(file);
const total = (extension) => files.filter((file) => file.name.endsWith(extension)).reduce((sum, file) => sum + file.size, 0);
const entries = Object.entries(manifest);

function closureKeys(entryKey) {
  const visited = new Set();
  const visit = (key) => {
    if (!key || visited.has(key)) return;
    visited.add(key);
    for (const imported of manifest[key]?.imports ?? []) visit(imported);
  };
  visit(entryKey);
  return visited;
}

// A route wrapper that immediately renders a lazy `*-workspace-content`
// component has not deferred its first paint. Count that content with the
// route, while leaving dialogs and other interaction-only dynamic imports out
// of the route budget.
function firstPaintRouteKeys(entryKey) {
  const keys = closureKeys(entryKey);
  for (const dynamicKey of manifest[entryKey]?.dynamicImports ?? []) {
    const source = manifest[dynamicKey]?.src ?? "";
    if (!source.endsWith("-workspace-content.tsx")) continue;
    for (const key of closureKeys(dynamicKey)) keys.add(key);
  }
  return keys;
}

function jsSize(keys) {
  return [...keys].map((key) => manifest[key]?.file).filter((file) => file?.endsWith(".js")).reduce((sum, file) => sum + sizeFor(file), 0);
}

function cssFiles(keys) {
  return new Set([...keys].flatMap((key) => manifest[key]?.css ?? []));
}

function cssSize(keys) {
  return [...cssFiles(keys)].reduce((sum, file) => sum + sizeFor(file), 0);
}

const startup = manifest["index.html"];
if (!startup) throw new Error("Web startup entry is missing from the Vite manifest.");
const workspacePageContentKey = entries.find(([, entry]) => entry.src === "src/workspace-page-content.tsx")?.[0];
const sectionIconKey = entries.find(([, entry]) => entry.src === "src/baseer-section-icon.tsx")?.[0];
const workspaceStylesKey = entries.find(([, entry]) => entry.src === "src/workspace-styles.ts")?.[0];
const hrWorkspaceRouterKey = entries.find(([, entry]) => entry.src === "src/hr-workspace-router.tsx")?.[0];
// BaseerSectionIcon is permitted to be statically folded into startup. It is
// then already included in startupKeys, so requiring a separate manifest
// entry would make this measurement fail without representing a new download.
if (!workspacePageContentKey || !workspaceStylesKey || !hrWorkspaceRouterKey) throw new Error("Authenticated workspace shell entries are missing from the Vite manifest.");
const routeEntries = entries.filter(([key, entry]) => key !== workspacePageContentKey && entry.isDynamicEntry && /(?:workspace|command-center-sales-calendar)\.(?:tsx|ts)$/.test(entry.src ?? ""));
if (!routeEntries.length) throw new Error("No lazy workspace entries were found in the Vite manifest.");

const startupKeys = closureKeys("index.html");
const initialJs = jsSize(startupKeys);
const authenticatedShellKeys = new Set([
  ...closureKeys(workspacePageContentKey),
  ...(sectionIconKey ? closureKeys(sectionIconKey) : []),
  ...closureKeys(workspaceStylesKey),
]);
const authenticatedShellJs = jsSize(new Set([...authenticatedShellKeys].filter((key) => !startupKeys.has(key))));
const authenticatedShellCss = cssSize(new Set([...authenticatedShellKeys].filter((key) => !startupKeys.has(key))));
const journeySharedKeys = (entry) => entry.src?.startsWith("src/hr-") && entry.src !== "src/hr-workspace-router.tsx"
  ? new Set([...authenticatedShellKeys, ...closureKeys(hrWorkspaceRouterKey)])
  : authenticatedShellKeys;
const journeys = routeEntries.flatMap(([key, entry]) => {
  // Marketing has five independently rendered sections. Measure each selected
  // leaf with the shell that loads it; counting only the dispatcher would hide
  // the user's actual first-paint cost, while counting all five would model a
  // journey no user can take.
  if (entry.src === "src/marketing-workspace.tsx") {
    const shellKeys = closureKeys(key);
    const leaves = (entry.dynamicImports ?? [])
      .filter((dynamicKey) => /^src\/marketing-(?:overview|campaigns|reputation|google-ads|policies)-workspace\.tsx$/.test(manifest[dynamicKey]?.src ?? ""));
    if (leaves.length !== 5) throw new Error("Marketing workspace must expose five independently budgeted section entries.");
    return leaves.map((leafKey) => {
      const keys = new Set([...journeySharedKeys(entry), ...shellKeys, ...closureKeys(leafKey)]);
      const additionalKeys = new Set([...keys].filter((file) => !startupKeys.has(file)));
      const routeOnlyKeys = new Set([...additionalKeys].filter((file) => !authenticatedShellKeys.has(file)));
      return { source: `${entry.src} -> ${manifest[leafKey].src}`, js: jsSize(additionalKeys), css: cssSize(routeOnlyKeys) };
    });
  }
  const additionalKeys = new Set([...journeySharedKeys(entry), ...firstPaintRouteKeys(key)].filter((file) => !startupKeys.has(file)));
  const routeOnlyKeys = new Set([...additionalKeys].filter((file) => !authenticatedShellKeys.has(file)));
  return [{ source: entry.src, js: jsSize(additionalKeys), css: cssSize(routeOnlyKeys) }];
});
const largestJourney = journeys.reduce((largest, journey) => journey.js > largest.js ? journey : largest);
const largestCssJourney = journeys.reduce((largest, journey) => journey.css > largest.css ? journey : largest);
const marketingShellKey = routeEntries.find(([, entry]) => entry.src === "src/marketing-workspace.tsx")?.[0];
if (!marketingShellKey) throw new Error("Marketing workspace entry is missing from the Vite manifest.");

function entryKeyForSource(source) {
  const key = entries.find(([, entry]) => entry.src === source)?.[0];
  if (!key) throw new Error(`Expected interaction entry is missing from the Vite manifest: ${source}`);
  return key;
}

function entryKeyForName(name) {
  const key = entries.find(([, entry]) => entry.name === name)?.[0];
  if (!key) throw new Error(`Expected named manifest entry is missing: ${name}`);
  return key;
}

function entryKeyForSourceOrNull(source) {
  return entries.find(([, entry]) => entry.src === source)?.[0] ?? null;
}

// Interaction budgets count the incremental files fetched after a user already
// opened the relevant marketing section. They keep dialogs honest without
// incorrectly charging their optional code to the section's first paint.
function marketingInteractionJs(sectionSource, interactionSource) {
  const before = new Set([...closureKeys(marketingShellKey), ...closureKeys(entryKeyForSource(sectionSource))]);
  const after = new Set([...before, ...closureKeys(entryKeyForSource(interactionSource))]);
  return jsSize(new Set([...after].filter((key) => !before.has(key))));
}

// The decision home is a real first-paint summary. Its complete management
// surface is intentionally user-triggered, so cap that incremental action
// separately instead of either charging it to first paint or leaving it
// unmeasured.
function workspaceInteractionJs(workspaceSource, firstPaintSource, interactionSource, { allowStaticInFirstPaint = false } = {}) {
  const workspaceKey = entryKeyForSource(workspaceSource);
  const firstPaintKey = entryKeyForSourceOrNull(firstPaintSource);
  const before = firstPaintKey
    ? new Set([...closureKeys(workspaceKey), ...closureKeys(firstPaintKey)])
    : firstPaintRouteKeys(workspaceKey);
  const interactionKey = entryKeyForSourceOrNull(interactionSource);
  if (!interactionKey) {
    if (!allowStaticInFirstPaint) throw new Error(`Expected interaction entry is missing from the Vite manifest: ${interactionSource}`);
    const interactionImport = `./${interactionSource.replace(/^src\//, "").replace(/\.(?:tsx|ts)$/, "")}`;
    const staticImportPattern = new RegExp(`import\\s+[^;]*?from\\s+["']${interactionImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    // Some routes intentionally place the static management surface in the
    // route wrapper itself rather than in its optional content facade. Either
    // location is already charged to first paint and therefore has zero
    // incremental interaction cost.
    const staticSources = [firstPaintSource, workspaceSource];
    const hasStaticImport = staticSources.some((source) => staticImportPattern.test(readFileSync(join("apps", "web", source), "utf8")));
    if (!hasStaticImport) throw new Error(`Expected ${interactionSource} to be a static first-paint dependency of ${firstPaintSource} or ${workspaceSource}.`);
    return 0;
  }
  const after = new Set([...before, ...closureKeys(interactionKey)]);
  return jsSize(new Set([...after].filter((key) => !before.has(key))));
}

const campaignMutationInteractionJs = marketingInteractionJs("src/marketing-campaigns-workspace.tsx", "src/marketing-campaign-mutation-dialog.tsx");
const campaignDetailsInteractionJs = marketingInteractionJs("src/marketing-campaigns-workspace.tsx", "src/marketing-campaign-details-dialog.tsx");
const reputationReplyPolicyInteractionJs = marketingInteractionJs("src/marketing-reputation-workspace.tsx", "src/marketing-reputation-reply-policy-editor.tsx");
const decisionFullAnalysisInteractionJs = workspaceInteractionJs("src/decision-intelligence-workspace.tsx", "src/decision-intelligence-workspace-content.tsx", "src/decision-intelligence-workspace-runtime.tsx", { allowStaticInFirstPaint: true });
// The command-center runtime is intentionally loaded with the selected route.
// Its cost is therefore covered by the first-paint journey; there is no
// additional runtime chunk to charge to an interaction budget.
const commandCenterFullInteractionJs = workspaceInteractionJs("src/command-center-workspace.tsx", "src/command-center-workspace-content.tsx", "src/command-center-workspace-runtime.tsx", { allowStaticInFirstPaint: true });
const reportsWorkspaceInteractionJs = workspaceInteractionJs("src/reports-workspace.tsx", "src/reports-workspace-content.tsx", "src/reports-workspace-runtime.tsx");
const vatSimulationInteractionJs = workspaceInteractionJs("src/vat-simulation-workspace.tsx", "src/vat-simulation-workspace.tsx", "src/internal-vat-report-workspace.tsx");
const financeSetupInteractionJs = workspaceInteractionJs("src/finance-setup-workspace.tsx", "src/finance-setup-workspace-content.tsx", "src/finance-setup-workspace-runtime.tsx");
const operationsExecutionInteractionJs = workspaceInteractionJs("src/operations-execution-workspace.tsx", "src/operations-execution-workspace-content.tsx", "src/operations-execution-workspace-runtime.tsx");
const marketingOverviewSpendInteractionJs = marketingInteractionJs("src/marketing-overview-workspace.tsx", "src/marketing-overview-spend-runtime.tsx");
const ledgerTrialBalanceInteractionJs = workspaceInteractionJs("src/ledger-trial-balance-workspace.tsx", "src/ledger-trial-balance-workspace.tsx", "src/ledger-trial-balance-workspace-runtime.tsx");
const invoiceRegisterInteractionJs = workspaceInteractionJs("src/invoice-register-workspace.tsx", "src/invoice-register-workspace.tsx", "src/invoice-register-workspace-runtime.tsx");
const operationsReportsInteractionJs = workspaceInteractionJs("src/operations-reports-workspace.tsx", "src/operations-reports-workspace.tsx", "src/operations-reports-workspace-runtime.tsx");
const expensesObligationsInteractionJs = workspaceInteractionJs("src/expenses-obligations-workspace.tsx", "src/expenses-obligations-workspace.tsx", "src/expenses-obligations-workspace-runtime.tsx");
const marketingCalendarInteractionJs = marketingInteractionJs("src/marketing-calendar-workspace.tsx", "src/marketing-calendar-workspace-runtime.tsx");
const financeAccountsInteractionJs = workspaceInteractionJs("src/finance-accounts-workspace.tsx", "src/finance-accounts-workspace.tsx", "src/finance-accounts-workspace-runtime.tsx");
const internalVatDetailedInteractionJs = workspaceInteractionJs("src/internal-vat-report-workspace.tsx", "src/internal-vat-report-workspace.tsx", "src/internal-vat-report-workspace-runtime.tsx");
const treasuryInteractionJs = workspaceInteractionJs("src/treasury-workspace.tsx", "src/treasury-workspace.tsx", "src/treasury-workspace-runtime.tsx");
const recurringExpenseInteractionJs = workspaceInteractionJs("src/recurring-expense-workspace.tsx", "src/recurring-expense-workspace.tsx", "src/recurring-expense-workspace-runtime.tsx");
const ownerDailyBriefInteractionJs = workspaceInteractionJs("src/owner-dashboard-workspace.tsx", "src/owner-daily-brief-workspace.tsx", "src/owner-daily-brief-workspace-runtime.tsx");
const totalLazyJs = total(".js") - initialJs;
const totalCss = total(".css");
const comboboxLazyJs = files.filter((file) => /^baseer-combobox-.*\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);
// Vite folds the private runtime into the public DatePicker facade. Measure
// that public entry's full post-startup closure so a calendar dependency
// regression cannot look like a zero-byte interaction.
const datePickerRuntimeKey = entryKeyForName("baseer-date-picker");
const datePickerRuntimeFile = manifest[datePickerRuntimeKey]?.file;
if (!datePickerRuntimeFile?.startsWith("assets/baseer-date-picker-") || !datePickerRuntimeFile.endsWith(".js")) {
  throw new Error(`DatePicker must emit a named baseer-date-picker chunk; received ${datePickerRuntimeFile ?? "no file"}.`);
}
const datePickerLazyJs = jsSize(new Set([...closureKeys(datePickerRuntimeKey)].filter((key) => !startupKeys.has(key))));
const formLazyJs = files.filter((file) => /^baseer-(?:required-textarea-form|validated-form)-.*\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);
const formStateLazyJs = files.filter((file) => /^baseer-form-state-.*\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);
const chartLazyJs = files.filter((file) => /^baseer-chart-.*\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);
const dataGridLazyJs = files.filter((file) => /^baseer-data-grid-.*\.js$/.test(file.name)).reduce((sum, file) => sum + file.size, 0);

// A user loads startup plus one workspace journey. Cache totals are reported for observability,
// but only startup and the largest individual journey are release gates.
// The React Aria adapter is an interaction-only chunk. It is deliberately not
// charged to the initial HR route, but it has its own hard ceiling so a future
// library upgrade cannot grow the filter interaction unnoticed.
// ECharts' modular SVG runtime is intentionally loaded only when the overview
// chart is rendered. Its measured first interaction is 492,648 B; the tight
// 500 KB ceiling protects that isolated cost without charging app startup.
// The login now consumes the shared text-input and button contracts. Keep the
// startup ceiling tight while allowing their 330 B production overhead.
// Campaign management is the largest measured first workspace at 90.2 KB;
// the 95 KB ceiling leaves only a narrow regression margin. The global CSS
// bundle is 63.1 KB after the current shared form contracts, so cap it at 65 KB.
const limits = { initialJs: 251_000, authenticatedShellJs: 20_000, authenticatedShellCss: 100_000, largestJourneyJs: 95_000, initialCss: 65_000, largestJourneyCss: 16_000, campaignMutationInteractionJs: 150_000, campaignDetailsInteractionJs: 50_000, reputationReplyPolicyInteractionJs: 125_000, decisionFullAnalysisInteractionJs: 200_000, commandCenterFullInteractionJs: 200_000, reportsWorkspaceInteractionJs: 200_000, vatSimulationInteractionJs: 200_000, financeSetupInteractionJs: 200_000, operationsExecutionInteractionJs: 200_000, marketingOverviewSpendInteractionJs: 200_000, ledgerTrialBalanceInteractionJs: 200_000, invoiceRegisterInteractionJs: 200_000, operationsReportsInteractionJs: 200_000, expensesObligationsInteractionJs: 200_000, marketingCalendarInteractionJs: 200_000, financeAccountsInteractionJs: 200_000, internalVatDetailedInteractionJs: 200_000, treasuryInteractionJs: 200_000, recurringExpenseInteractionJs: 200_000, ownerDailyBriefInteractionJs: 200_000, comboboxLazyJs: 200_000, datePickerLazyJs: 200_000, formLazyJs: 100_000, formStateLazyJs: 110_000, chartLazyJs: 500_000, dataGridLazyJs: 50_000 };
const sizes = { initialJs, authenticatedShellJs, authenticatedShellCss, largestJourneyJs: largestJourney.js, initialCss: cssSize(startupKeys), largestJourneyCss: largestCssJourney.css, campaignMutationInteractionJs, campaignDetailsInteractionJs, reputationReplyPolicyInteractionJs, decisionFullAnalysisInteractionJs, commandCenterFullInteractionJs, reportsWorkspaceInteractionJs, vatSimulationInteractionJs, financeSetupInteractionJs, operationsExecutionInteractionJs, marketingOverviewSpendInteractionJs, ledgerTrialBalanceInteractionJs, invoiceRegisterInteractionJs, operationsReportsInteractionJs, expensesObligationsInteractionJs, marketingCalendarInteractionJs, financeAccountsInteractionJs, internalVatDetailedInteractionJs, treasuryInteractionJs, recurringExpenseInteractionJs, ownerDailyBriefInteractionJs, comboboxLazyJs, datePickerLazyJs, formLazyJs, formStateLazyJs, chartLazyJs, dataGridLazyJs };
console.log(`Web gzip-transfer budgets: startup JS ${sizes.initialJs} B / ${limits.initialJs} B; authenticated shell JS ${sizes.authenticatedShellJs} B / ${limits.authenticatedShellJs} B; authenticated shell CSS ${sizes.authenticatedShellCss} B / ${limits.authenticatedShellCss} B.`);
console.log(`Web marketing interaction budgets: campaign mutation ${sizes.campaignMutationInteractionJs} B / ${limits.campaignMutationInteractionJs} B; campaign details ${sizes.campaignDetailsInteractionJs} B / ${limits.campaignDetailsInteractionJs} B; reputation reply policy ${sizes.reputationReplyPolicyInteractionJs} B / ${limits.reputationReplyPolicyInteractionJs} B.`);
console.log(`Web decision interaction budget: full analysis ${sizes.decisionFullAnalysisInteractionJs} B / ${limits.decisionFullAnalysisInteractionJs} B.`);
console.log(`Web command-center interaction budget: full workspace ${sizes.commandCenterFullInteractionJs} B / ${limits.commandCenterFullInteractionJs} B.`);
console.log(`Web reports interaction budget: selected report ${sizes.reportsWorkspaceInteractionJs} B / ${limits.reportsWorkspaceInteractionJs} B.`);
console.log(`Web VAT interaction budget: selected company report ${sizes.vatSimulationInteractionJs} B / ${limits.vatSimulationInteractionJs} B.`);
console.log(`Web finance-setup interaction budget: management ${sizes.financeSetupInteractionJs} B / ${limits.financeSetupInteractionJs} B.`);
console.log(`Web operations execution interaction budget: management ${sizes.operationsExecutionInteractionJs} B / ${limits.operationsExecutionInteractionJs} B.`);
console.log(`Web marketing overview interaction budget: spend read ${sizes.marketingOverviewSpendInteractionJs} B / ${limits.marketingOverviewSpendInteractionJs} B.`);
console.log(`Web Trial Balance interaction budget: official report ${sizes.ledgerTrialBalanceInteractionJs} B / ${limits.ledgerTrialBalanceInteractionJs} B.`);
console.log(`Web invoice register interaction budget: full register ${sizes.invoiceRegisterInteractionJs} B / ${limits.invoiceRegisterInteractionJs} B.`);
console.log(`Web operations reports interaction budget: full reports ${sizes.operationsReportsInteractionJs} B / ${limits.operationsReportsInteractionJs} B.`);
console.log(`Web expenses and obligations interaction budget: management ${sizes.expensesObligationsInteractionJs} B / ${limits.expensesObligationsInteractionJs} B.`);
console.log(`Web marketing calendar interaction budget: calendar and analysis ${sizes.marketingCalendarInteractionJs} B / ${limits.marketingCalendarInteractionJs} B.`);
console.log(`Web finance accounts interaction budget: account management ${sizes.financeAccountsInteractionJs} B / ${limits.financeAccountsInteractionJs} B.`);
console.log(`Web internal VAT interaction budget: detailed report ${sizes.internalVatDetailedInteractionJs} B / ${limits.internalVatDetailedInteractionJs} B.`);
console.log(`Web treasury interaction budget: management ${sizes.treasuryInteractionJs} B / ${limits.treasuryInteractionJs} B.`);
console.log(`Web recurring expenses interaction budget: management and payments ${sizes.recurringExpenseInteractionJs} B / ${limits.recurringExpenseInteractionJs} B.`);
console.log(`Web owner daily brief interaction budget: full brief ${sizes.ownerDailyBriefInteractionJs} B / ${limits.ownerDailyBriefInteractionJs} B.`);
for (const [kind, limit] of Object.entries(limits)) {
  if (sizes[kind] > limit) {
    const source = kind === "largestJourneyJs" ? ` from ${largestJourney.source}` : kind === "largestJourneyCss" ? ` from ${largestCssJourney.source}` : "";
    throw new Error(`Web ${kind.toUpperCase()} bundle is ${sizes[kind]} bytes; release limit is ${limit}${source}.`);
  }
}
console.log(`Web release budget verified (startup JS ${sizes.initialJs} B / ${limits.initialJs} B; authenticated shell JS ${sizes.authenticatedShellJs} B / ${limits.authenticatedShellJs} B; authenticated shell CSS ${sizes.authenticatedShellCss} B / ${limits.authenticatedShellCss} B; largest route JS ${sizes.largestJourneyJs} B / ${limits.largestJourneyJs} B from ${largestJourney.source}; startup CSS ${sizes.initialCss} B / ${limits.initialCss} B; largest route CSS ${sizes.largestJourneyCss} B / ${limits.largestJourneyCss} B; Combobox interaction JS ${sizes.comboboxLazyJs} B / ${limits.comboboxLazyJs} B; DatePicker runtime interaction JS ${sizes.datePickerLazyJs} B / ${limits.datePickerLazyJs} B from ${datePickerRuntimeFile}; Form interaction JS ${sizes.formLazyJs} B / ${limits.formLazyJs} B; Form-state interaction JS ${sizes.formStateLazyJs} B / ${limits.formStateLazyJs} B; Chart interaction JS ${sizes.chartLazyJs} B / ${limits.chartLazyJs} B; DataGrid interaction JS ${sizes.dataGridLazyJs} B / ${limits.dataGridLazyJs} B; cache report lazy JS ${totalLazyJs} B, CSS ${totalCss} B).`);
