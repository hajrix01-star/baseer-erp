import assert from 'node:assert/strict';

import {
  INTERACTIVE_REPORT_MAX_CALENDAR_MONTHS,
  INTERACTIVE_REPORT_MAX_SOURCE_LINES,
  interactiveReportPeriodMessage,
  interactiveReportSourceMessage,
} from './interactive-report-limits.js';

const from = new Date('2024-01-01T00:00:00.000Z');
assert.equal(interactiveReportPeriodMessage(from, new Date('2025-12-31T00:00:00.000Z')), null);
assert.match(interactiveReportPeriodMessage(from, new Date('2026-01-01T00:00:00.000Z')) ?? '', /24/);
assert.equal(interactiveReportPeriodMessage(from, new Date('2030-01-01T00:00:00.000Z'), ['2024-01', '2030-01']), null);
assert.match(interactiveReportPeriodMessage(from, new Date('2024-01-01T00:00:00.000Z'), Array.from({ length: INTERACTIVE_REPORT_MAX_CALENDAR_MONTHS + 1 }, () => '2024-01')) ?? '', /24/);
assert.equal(interactiveReportSourceMessage(INTERACTIVE_REPORT_MAX_SOURCE_LINES), null);
assert.match(interactiveReportSourceMessage(INTERACTIVE_REPORT_MAX_SOURCE_LINES + 1) ?? '', /10,000/);

console.log('interactive report limits policy verification passed');
