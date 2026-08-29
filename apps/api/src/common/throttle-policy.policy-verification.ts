import assert from 'node:assert/strict';
import 'reflect-metadata';

import { AttendanceController } from '../attendance/attendance.controller.js';
import { HrEmployeeDocumentController } from '../hr/hr-employee-document.controller.js';
import { AuthController } from '../identity/auth.controller.js';
import { OutputController } from '../output/output.controller.js';
import { InternalVatReportController } from '../reports/internal-vat-report.controller.js';
import { LedgerTrialBalanceController } from '../reports/ledger-trial-balance.controller.js';
import { OfficialReportRunsController } from '../reports/official-report-runs.controller.js';
import { ReportDocumentController } from '../reports/report-document.controller.js';
import { ReportsController } from '../reports/reports.controller.js';
import { VatSimulationController } from '../reports/vat-simulation.controller.js';

type ThrottlerName = 'authIp' | 'authIdentity' | 'report' | 'output' | 'fileWrite' | 'attendancePin';

const all: readonly ThrottlerName[] = ['authIp', 'authIdentity', 'report', 'output', 'fileWrite', 'attendancePin'];

/**
 * Named Nest throttlers compose unless every unrelated limiter is explicitly
 * skipped. This protects report reads from accidentally consuming the tiny
 * authentication attempt budget.
 */
function verifyPolicy(target: object, enabled: readonly ThrottlerName[]) {
  for (const name of all) {
    if (enabled.includes(name)) {
      assert.notEqual(Reflect.getMetadata(`THROTTLER:SKIP${name}`, target), true, `${name} must remain active`);
      assert.notEqual(Reflect.getMetadata(`THROTTLER:LIMIT${name}`, target), undefined, `${name} must define a limit`);
    } else {
      assert.equal(Reflect.getMetadata(`THROTTLER:SKIP${name}`, target), true, `${name} must be skipped when another limiter is active`);
    }
  }
}

for (const controller of [ReportsController, LedgerTrialBalanceController, InternalVatReportController, VatSimulationController]) verifyPolicy(controller, ['report']);
for (const controller of [OfficialReportRunsController, ReportDocumentController, OutputController]) verifyPolicy(controller, ['output']);
verifyPolicy(HrEmployeeDocumentController.prototype.create, ['fileWrite']);
verifyPolicy(HrEmployeeDocumentController.prototype.replace, ['fileWrite']);
for (const endpoint of [AuthController.prototype.signIn, AuthController.prototype.activateOwner, AuthController.prototype.refresh]) verifyPolicy(endpoint, ['authIp', 'authIdentity']);
for (const endpoint of [AttendanceController.prototype.record, AttendanceController.prototype.employeePortalSession, AttendanceController.prototype.employeePortalProfile]) verifyPolicy(endpoint, ['attendancePin']);

console.log('throttle policy verification passed');
