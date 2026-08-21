import assert from "node:assert/strict";

import { normalizeOfficialEvents } from "./decision-context-import.service.js";
import { normalizeResearchCandidates } from "./decision-context-research.service.js";

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

console.log("Decision context policy verification passed: imported events and researcher candidates deduplicate, while conflicts require review.");
