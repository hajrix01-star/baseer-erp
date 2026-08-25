import assert from 'node:assert/strict';
import 'reflect-metadata';

import { HrEmployeeDocumentController } from '../hr/hr-employee-document.controller.js';
import { OutputController } from '../output/output.controller.js';
import { InternalVatReportController } from '../reports/internal-vat-report.controller.js';
import { LedgerTrialBalanceController } from '../reports/ledger-trial-balance.controller.js';
import { OfficialReportRunsController } from '../reports/official-report-runs.controller.js';
import { ReportDocumentController } from '../reports/report-document.controller.js';
import { ReportsController } from '../reports/reports.controller.js';

type ThrottlerName = 'authIp' | 'authIdentity' | 'report' | 'output' | 'fileWrite';

const all: readonly ThrottlerName[] = ['authIp', 'authIdentity', 'report', 'output', 'fileWrite'];

/**
 * Named Nest throttlers compose unless every unrelated limiter is explicitly
 * skipped. This protects report reads from accidentally consuming the tiny
 * authentication attempt budget.
 */
function verifyPolicy(target: object, enabled: ThrottlerName) {
  assert.notEqual(Reflect.getMetadata(`THROTTLER:SKIP${enabled}`, target), true, `${enabled} must remain active`);
  assert.notEqual(Reflect.getMetadata(`THROTTLER:LIMIT${enabled}`, target), undefined, `${enabled} must define a limit`);
  for (const name of all) {
    if (name !== enabled) assert.equal(Reflect.getMetadata(`THROTTLER:SKIP${name}`, target), true, `${name} must be skipped when ${enabled} is active`);
  }
}

for (const controller of [ReportsController, LedgerTrialBalanceController, InternalVatReportController]) verifyPolicy(controller, 'report');
for (const controller of [OfficialReportRunsController, ReportDocumentController, OutputController]) verifyPolicy(controller, 'output');
verifyPolicy(HrEmployeeDocumentController.prototype.create, 'fileWrite');
verifyPolicy(HrEmployeeDocumentController.prototype.replace, 'fileWrite');

console.log('throttle policy verification passed');
