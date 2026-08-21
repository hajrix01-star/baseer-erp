import assert from "node:assert/strict";

import { normalizeOfficialEvents } from "./decision-context-import.service.js";
import { extractNcmWeatherCandidates, normalizeResearchCandidates, sourceRecord } from "./decision-context-research.service.js";
import { buildSaudiContextCatalogDocument, getSaudiOccasionsForYear } from "./saudi-context-catalog.js";

const duplicate = normalizeOfficialEvents("SA_MOE_ACADEMIC_CALENDAR", {
  events: [
    { eventKind: "academic_break", titleAr: "إجازة منتصف الفصل", startsOn: "2026-10-01", endsOn: "2026-10-05" },
    { eventKind: "academic_break", titleAr: "إجازة منتصف الفصل", startsOn: "2026-10-01", endsOn: "2026-10-05" },
  ],
});
assert.equal(duplicate.events.length, 1, "Exact duplicate source events must collapse into one occurrence.");
assert.equal(duplicate.duplicateCount, 1, "The importer must report suppressed duplicates.");

const conflict = normalizeOfficialEvents("SA_MOE_ACADEMIC_CALENDAR", {
  events: [
    { eventKind: "academic_break", titleAr: "إجازة منتصف الفصل", startsOn: "2026-10-01", endsOn: "2026-10-05" },
    { eventKind: "academic_break", titleAr: "إجازة مختلفة", startsOn: "2026-10-01", endsOn: "2026-10-05" },
  ],
});
assert.equal(conflict.events.length, 0, "Conflicting copies of one occurrence must not auto-publish.");
assert.equal(conflict.conflicts.length, 1, "The importer must send a conflicting occurrence to review.");

const candidateDuplicate = normalizeResearchCandidates("SA_SPL_FIXTURES", {
  candidates: [
    { externalKey: "spl:match:123", eventKind: "FOOTBALL_MATCH", titleAr: "مباراة الهلال والنصر", startsOn: "2026-10-01", endsOn: "2026-10-01", locationCode: "RIYADH", locationLabelAr: "الرياض" },
    { externalKey: "spl:match:123", eventKind: "FOOTBALL_MATCH", titleAr: "مباراة الهلال والنصر", startsOn: "2026-10-01", endsOn: "2026-10-01", locationCode: "RIYADH", locationLabelAr: "الرياض" },
  ],
});
assert.equal(candidateDuplicate.candidates.length, 1, "Exact researcher candidates must collapse before review.");
assert.equal(candidateDuplicate.duplicateCount, 1, "The researcher must report suppressed candidate duplicates.");

const candidateConflict = normalizeResearchCandidates("SA_SPL_FIXTURES", {
  candidates: [
    { externalKey: "spl:match:123", eventKind: "FOOTBALL_MATCH", titleAr: "مباراة الهلال والنصر", startsOn: "2026-10-01", endsOn: "2026-10-01" },
    { externalKey: "spl:match:123", eventKind: "FOOTBALL_MATCH", titleAr: "مباراة مختلفة", startsOn: "2026-10-01", endsOn: "2026-10-01" },
  ],
});
assert.equal(candidateConflict.candidates.length, 0, "Conflicting researcher candidates must not enter review as facts.");
assert.equal(candidateConflict.conflicts.length, 1, "A conflicting candidate occurrence must be visible for review.");

const ncmCandidates = extractNcmWeatherCandidates(
  { locationCode: "DAMMAM", locationLabelAr: "الدمام", url: "https://www.ncm.gov.sa/ar/region/eastern/governorates/Ad-Dammam" },
  `<main><h1>الدمام</h1><p>العظمى ٤٨ °م</p><section><a href="/ar/early-warning/83713">عرض التحذير</a><p>موجة حارة</p><p>تاريخ البداية: الجمعة ٢١/٠٨/٢٠٢٦</p><p>تاريخ النهاية: السبت ٢٢/٠٨/٢٠٢٦</p></section><footer>آخر تحديث : الجمعة ٢١/٠٨/٢٠٢٦</footer></main>`,
  "2026-08-21T04:30:00.000Z",
);
assert.equal(ncmCandidates.length, 2, "NCM public pages must yield separate heat and early-warning review candidates.");
assert.equal(ncmCandidates[0]?.externalKey, "ncm:high_temperature:DAMMAM:2026-08-21", "The NCM high-temperature key must remain stable for the city and date.");
assert.equal(ncmCandidates[1]?.startsOn, "2026-08-21", "The NCM warning must normalize Arabic-digit source dates.");
assert.equal(ncmCandidates[1]?.endsOn, "2026-08-22", "The NCM warning must preserve its published end date.");

const persistedResearchSource = sourceRecord({
  sourceCode: "TEST_SOURCE",
  displayNameAr: "مصدر اختبار",
  sourceUrl: "https://example.test/source",
  scheduleCode: "DAILY",
  allowedHosts: ["example.test"],
  adapter: "CONFIGURED_JSON",
});
assert.deepEqual(Object.keys(persistedResearchSource).sort(), ["displayNameAr", "scheduleCode", "sourceCode", "sourceUrl"], "Runtime adapter and allow-list settings must never be passed to the DecisionContextSource database model.");

const saudiCatalogue = buildSaudiContextCatalogDocument("SA_UMM_AL_QURA_OCCASIONS");
assert.ok(saudiCatalogue.events.some((event) => event.eventKind === "NATIONAL_DAY"), "The local Saudi catalogue must include National Day.");
assert.ok(saudiCatalogue.events.some((event) => event.eventKind === "RAMADAN_ESTIMATED"), "The local Saudi catalogue must label calculated Islamic dates as estimated.");
const distinctLocalKeys = new Set(saudiCatalogue.events.map((event) => event.externalKey));
assert.equal(distinctLocalKeys.size, saudiCatalogue.events.length, "The local Saudi catalogue must never emit duplicate occurrence keys.");
assert.ok(getSaudiOccasionsForYear(2026).every((event) => event.startsOn <= event.endsOn), "Every local Saudi occasion must have a valid date range.");

const academicCatalogue = buildSaudiContextCatalogDocument("SA_MOE_ACADEMIC_CALENDAR");
assert.ok(academicCatalogue.events.some((event) => event.eventKind === "SCHOOL_ACADEMIC_BREAK"), "The reviewed school catalogue must provide academic breaks.");

console.log("Decision context policy verification passed: local catalogues, imported events and researcher candidates deduplicate, while conflicts require review.");
