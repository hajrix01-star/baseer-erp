import { reportRunChecksum, canonicalJson } from './report-run.service.js';

const left = canonicalJson({ period: { to: '2026-08-31', from: '2026-08-01' }, zeroRows: false });
const right = canonicalJson({ zeroRows: false, period: { from: '2026-08-01', to: '2026-08-31' } });
const base = {
  reportCode: 'ledger_trial_balance', definitionVersion: 'v1', canonicalOptions: left,
  economicAsOfDate: new Date('2026-08-31T00:00:00.000Z'), ledgerRevision: BigInt(41),
  sourceCoverage: canonicalJson({ status: 'COMPLETE', sources: ['ledger'] }), projectionWatermark: null,
  accountMappingVersionId: null, accountMappingChecksum: null,
};
const reordered = { ...base, canonicalOptions: right };
const laterRevision = { ...base, ledgerRevision: BigInt(42) };

if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error('Canonical options must have deterministic key order.');
if (reportRunChecksum(base) !== reportRunChecksum(reordered)) throw new Error('Equivalent canonical options must produce the same run checksum.');
if (reportRunChecksum(base) === reportRunChecksum(laterRevision)) throw new Error('Ledger revision must change the report-run checksum.');

console.log('R0-B report-run boundary policy verification passed.');
