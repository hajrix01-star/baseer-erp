import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured through apps/api/.env.baseer-test.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const fixture = { tenantId: randomUUID(), companyId: randomUUID(), otherCompanyId: randomUUID(), actorUserId: randomUUID() };
const context = { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.actorUserId };
let app;

try {
  await seed();
  const [{ AppModule }, { DatabaseService }, { MarketingService }, { marketingCalendarReadSchema }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/database/database.service.js"),
    import("../apps/api/dist/marketing/marketing.service.js"),
    import("../packages/contracts/dist/marketing.js"),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const marketing = app.get(MarketingService);
  const request = { titleAr: "حملة تحقق", titleEn: "Verification campaign", platform: "MANUAL", status: "PLANNED", startsOn: "2026-08-01", endsOn: "2026-08-31", objective: "اختبار العزل", idempotencyKey: randomUUID() };
  const created = await marketing.createCampaign(context, request);
  const replayed = await marketing.createCampaign(context, request);
  assert.equal(replayed.id, created.id, "A matching idempotency request must replay the original campaign receipt.");
  assert.equal(replayed.replayed, true, "A matching idempotency request must be marked replayed.");
  await assert.rejects(() => marketing.createCampaign(context, { ...request, titleAr: "طلب مختلف" }), /different marketing request/i, "A reused key with another payload must be rejected.");
  const workspace = await marketing.workspace(context);
  assert.equal(workspace.campaigns.length, 1, "The company register must return its campaign.");
  assert.equal(workspace.readiness.every((entry) => entry.status === "NOT_CONNECTED"), true, "Provider readiness must not masquerade as a zero metric.");
  assert.equal(workspace.replyPolicy.executionReadiness, "NOT_CONNECTED", "Saving reply configuration must not imply a live publisher.");
  const connectionsBefore = await marketing.providerConnections(context);
  assert.equal(connectionsBefore.liveOauthEnabled, false, "The connection control centre must never claim a live OAuth flow before the provider gate.");
  assert.equal(connectionsBefore.connections.every((entry) => entry.status === "NOT_CONNECTED"), true, "Both provider connection states begin disconnected.");
  const providerSetupRequest = { idempotencyKey: randomUUID() };
  const providerSetup = await marketing.requestProviderConnectionSetup(context, "GOOGLE_ADS", providerSetupRequest);
  const providerSetupReplay = await marketing.requestProviderConnectionSetup(context, "GOOGLE_ADS", providerSetupRequest);
  assert.equal(providerSetupReplay.id, providerSetup.id, "A matching provider setup request must replay its receipt.");
  const connectionsAfter = await marketing.providerConnections(context);
  assert.equal(connectionsAfter.connections.find((entry) => entry.provider === "GOOGLE_ADS")?.status, "SETUP_REQUESTED", "A setup request is recorded without becoming a live connection.");
  assert.equal((await marketing.providerConnections({ ...context, companyId: fixture.otherCompanyId })).connections.every((entry) => entry.status === "NOT_CONNECTED"), true, "One company cannot read another company's setup request.");
  const companyEventId = randomUUID();
  await database.inTenantTransaction(fixture.tenantId, (tx) => tx.decisionCompanyContextEvent.create({ data: {
    id: companyEventId, tenantId: fixture.tenantId, companyId: fixture.companyId, createdByUserId: fixture.actorUserId,
    eventKind: "OPERATING_HOURS_CHANGE", titleAr: "حدث تسويقي متزامن", startsOn: new Date("2026-08-10T00:00:00.000Z"), endsOn: new Date("2026-08-12T00:00:00.000Z"),
    verificationStatus: "HUMAN_CONFIRMED", status: "PUBLISHED",
  } }));
  const contextLinkRequest = { companyEventId, idempotencyKey: randomUUID() };
  const contextLink = await marketing.linkContext(context, created.id, contextLinkRequest);
  const contextLinkReplay = await marketing.linkContext(context, created.id, contextLinkRequest);
  assert.equal(contextLinkReplay.id, contextLink.id, "A matching context-link request must replay its receipt.");
  const campaignAnalysis = await marketing.campaignAnalysis(context, created.id);
  assert.equal(campaignAnalysis.relatedContext.some((event) => event.id === companyEventId && event.explicitlyLinked), true, "A linked company event must be visible as explicit temporal context.");
  assert.equal(campaignAnalysis.spendResult.googleAdsStatus, "NOT_CONNECTED", "A campaign spend read must not invent Google Ads facts.");
  assert.equal(campaignAnalysis.spendResult.analysisBoundary, "DESCRIPTIVE_SPEND_SALES_ONLY_NOT_ROI_OR_CAUSATION", "Campaign spend results must remain descriptive, never causal or ROI.");
  await assert.rejects(() => marketing.linkFinancialDocument(context, created.id, { financialDocumentId: randomUUID(), idempotencyKey: randomUUID() }), /financial document was not found/i, "Marketing must reject an unknown Finance document rather than creating a financial record.");
  const calendar = await marketing.calendar(context, { from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-31T00:00:00.000Z") });
  const parsedCalendar = marketingCalendarReadSchema.parse(calendar);
  assert.equal(calendar.campaigns.some((campaign) => campaign.id === created.id), true, "The marketing calendar must consume the campaign register for the selected period.");
  assert.equal(calendar.days.length, 31, "The calendar must return one server-owned point per requested Riyadh business day.");
  assert.deepEqual(parsedCalendar.financialRead, {
    contractVersion: "financial-read.v1", subject: "MIXED_ANALYTICS", defaultTaxView: "VAT_INCLUDED", allowedTaxViews: ["VAT_INCLUDED"],
    authority: "OFFICIAL_SALES_AND_POSTED_FINANCE", quality: "INCOMPLETE", currencyScope: { mode: "SINGLE_CURRENCY", currencyCode: "SAR" }, presentationPolicy: "SERVER_FORMATTED",
  }, "Marketing must declare the shared VAT-inclusive, server-formatted financial-read contract.");
  assert.deepEqual(
    parsedCalendar.days.find((entry) => entry.businessDate === "2026-08-01"),
    {
      businessDate: "2026-08-01", officialGrossSales: "115.0000", officialGrossSalesDisplay: "115.00 SAR", officialGrossSalesCalendarDisplay: "115", officialNetSales: "100.0000", customerCount: 2, salesDayQuality: "READY",
      dailySalesTarget: null, dailySalesTargetDisplay: null, targetStatus: "NO_TARGET", linkedActualSpend: "0.0000", linkedActualSpendDisplay: "0.00 SAR", linkedFinancialDocumentCount: 0, campaignSpend: [],
      financialOutflows: "0.0000", financialOutflowsDisplay: "0.00 SAR", financialOutflowDocumentCount: 0, purchaseOutflows: "0.0000", purchaseOutflowsDisplay: "0.00 SAR", purchaseOutflowDocumentCount: 0, activeCampaignIds: [created.id],
    },
    "A ready calendar day must retain both VAT-inclusive and net sales from the server-owned daily summary.",
  );
  assert.equal(calendar.days.every((entry) => entry.officialNetSales !== null || entry.salesDayQuality !== "READY"), true, "A missing, pending, or partial sales day must never become a zero-valued ready point.");
  assert.equal(calendar.days.every((entry) => entry.officialGrossSales !== null || entry.salesDayQuality !== "READY"), true, "VAT-inclusive sales must also be absent, not zero, on unread days.");
  assert.deepEqual(parsedCalendar.weekdayAverages.find((entry) => entry.weekday === 6), { weekday: 6, averageOfficialGrossSales: "115.0000", averageOfficialGrossSalesDisplay: "115.00 SAR", averageOfficialGrossSalesCalendarDisplay: "115", eligibleDayCount: 1 }, "Weekday averages must be server-calculated from VAT-inclusive completed daily sales only.");
  assert.deepEqual(parsedCalendar.timeline.daily.rows.find((entry) => entry.label === "2026-08-01")?.sales, { amount: "115.0000", chartValue: 115, display: "115.00 SAR" }, "Daily chart values must be VAT-inclusive and fully formatted by the server.");
  const unreadTimelineRow = parsedCalendar.timeline.daily.rows.find((entry) => entry.salesDayQuality !== "READY");
  assert.deepEqual(unreadTimelineRow?.sales, { amount: null, chartValue: null, display: null }, "An incomplete daily chart row must be unavailable, never a fabricated zero.");
  const augustTimelineRow = parsedCalendar.timeline.monthly.rows.find((entry) => entry.label === "2026-08");
  assert.deepEqual(augustTimelineRow?.sales, { amount: null, chartValue: null, display: null }, "A month containing incomplete sales data must not aggregate to a misleading zero or partial financial total.");
  const unreadDays = parsedCalendar.days.filter((entry) => entry.officialNetSales === null);
  assert.ok(unreadDays.length > 0, "The verification period must include unread days to prove the unavailable-value contract.");
  assert.equal(unreadDays.every((entry) => entry.linkedActualSpend === null && entry.financialOutflows === null && entry.purchaseOutflows === null), true, "An unread day must use null for every comparable financial series; it must never be emitted as a financial zero.");
  assert.equal(calendar.days.some((entry) => entry.activeCampaignIds.includes(created.id)), true, "A dated campaign must appear in its daily timeline layer.");
  assert.equal(calendar.context.some((entry) => entry.id === companyEventId), true, "Published company context must appear as a calendar layer.");
  assert.equal(calendar.spendResult.googleAdsStatus, "NOT_CONNECTED", "Overview spend results must show Ads readiness honestly.");
  const replyPolicyRequest = { automationStatus: "ENABLED", authoringMethod: "TEMPLATE", tone: "WARM", languageMode: "MATCH_REVIEW", autoFourFiveEnabled: true, autoThreeIfSafe: true, signature: "فريق الشركة", idempotencyKey: randomUUID() };
  const policyCreated = await marketing.updateReputationReplyPolicy(context, replyPolicyRequest);
  const policyReplayed = await marketing.updateReputationReplyPolicy(context, replyPolicyRequest);
  assert.equal(policyReplayed.id, policyCreated.id, "A matching reply policy request must replay its receipt.");
  assert.equal(policyReplayed.replayed, true, "A matching reply policy request must be marked replayed.");
  const policyWorkspace = await marketing.workspace(context);
  assert.equal(policyWorkspace.replyPolicy.automationStatus, "ENABLED", "The company policy must retain its selected automation state.");
  assert.equal(policyWorkspace.replyPolicy.executionReadiness, "NOT_CONNECTED", "A configured policy must still report no live Google execution.");
  const otherPolicyWorkspace = await marketing.workspace({ ...context, companyId: fixture.otherCompanyId });
  assert.equal(otherPolicyWorkspace.replyPolicy.automationStatus, "DISABLED", "A company must not read another company's reply policy.");
  await assert.rejects(() => marketing.updateCampaign({ ...context, companyId: fixture.otherCompanyId }, created.id, { ...request, idempotencyKey: randomUUID(), titleAr: "محاولة شركة أخرى" }), /not found/i, "A company must not update another company's campaign.");
  await marketing.archiveCampaign(context, { campaignId: created.id, reason: "اختبار دورة الحياة", idempotencyKey: randomUUID() });
  const archived = await marketing.workspace(context);
  assert.equal(archived.campaigns[0]?.status, "ARCHIVED", "Archiving must preserve a campaign record.");
  const [auditCount, journalCount] = await database.inTenantTransaction(fixture.tenantId, async (tx) => Promise.all([
    tx.auditEvent.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, action: { startsWith: "marketing." } } }),
    tx.financeJournalEntry.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }),
  ]));
  assert.ok(auditCount >= 4, "Marketing create, context link, reply policy and archive must be audited.");
  assert.equal(journalCount, 0, "Marketing Gate A1 must not create financial journal entries.");
  const rls = await pool.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('MarketingCampaignFinancialLink', 'MarketingCampaignContextLink', 'MarketingProviderConnection')`);
  assert.equal(rls.rows.length, 3, "P2 links and the provider connection control-plane table must exist in PostgreSQL.");
  assert.equal(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity), true, "Marketing connection metadata must enforce RLS.");
  console.log(JSON.stringify({ ok: true, verified: ["company_scope", "idempotency_replay", "idempotency_mismatch", "archive_history", "reply_policy", "reply_policy_replay", "provider_setup_request", "provider_request_is_not_connection", "context_link", "daily_calendar_timeline", "missing_is_not_zero", "descriptive_spend_result", "finance_reference_rejection", "rls_force", "audit", "no_finance_posting", "honest_provider_readiness"] }));
} finally {
  await app?.close();
  await pool.end();
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, `marketing-${fixture.tenantId.slice(0, 8)}`, "Marketing verification tenant"]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [fixture.actorUserId, fixture.tenantId, `marketing-${fixture.actorUserId.slice(0, 8)}@baseer.test`, "مالك تحقق التسويق", "Marketing verification owner", "verification-only"]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7)', [fixture.companyId, fixture.tenantId, "شركة تحقق التسويق", "Marketing verification company", fixture.otherCompanyId, "شركة عزل أخرى", "Other isolation company"]);
    await client.query('INSERT INTO "FinanceDailyFinancialSummary" ("id", "tenantId", "companyId", "businessDate", "salesGrossAmount", "salesNetAmount", "salesVatAmount", "salesClosingCount", "customerCount", "operationalDayStatus", "dataStatus", "sourceChecksum") VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::decimal, $6::decimal, $7::decimal, $8, $9, $10::"FinanceOperationalDayStatus", $11::"FinanceDailySalesDataStatus", $12)', [randomUUID(), fixture.tenantId, fixture.companyId, "2026-08-01", "115.0000", "100.0000", "15.0000", 1, 2, "OPEN", "RECORDED", "a".repeat(64)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
