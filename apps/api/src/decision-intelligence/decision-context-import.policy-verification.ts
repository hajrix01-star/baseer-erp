import assert from "node:assert/strict";

import { normalizeOfficialEvents } from "./decision-context-import.service.js";

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

console.log("Decision context import policy verification passed: duplicate occurrences collapse and conflicts require review.");
