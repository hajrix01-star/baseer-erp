import assert from 'node:assert/strict';

import { hrEmployeeFinancialMovementSchema } from '@baseer-erp/contracts';
import { employeeMovementReference } from './hr-employee-movement-presentation.util.js';

assert.equal(
  employeeMovementReference({ sourceReference: 'cmr41c4k4002xy5z0bgpqymqq', description: 'سلفة تاريخية نوركس: ADV-20260702-002' }),
  'ADV-20260702-002',
  'Historical employee movements must use the operational document number without a relationship lookup.',
);
assert.equal(
  employeeMovementReference({ sourceReference: 'PAY-2026-08', description: null }),
  'PAY-2026-08',
  'Modern movements retain their native source reference when no description number is present.',
);

assert.equal(
  hrEmployeeFinancialMovementSchema.parse({
    id: 'b96533a9-b445-4fe1-98f4-6e4a98c15d1a',
    journalEntryId: '55c12c2d-6774-4eb4-aac1-11ae82207e33',
    movementType: 'ADVANCE_ISSUED',
    businessDate: '2026-07-02',
    amount: '-50.0000',
    sourceReference: employeeMovementReference({ sourceReference: 'cmr41c4k4002xy5z0bgpqymqq', description: 'سلفة تاريخية نوركس: ADV-20260702-002' }),
    description: 'سلفة تاريخية نوركس: ADV-20260702-002',
  }).sourceReference,
  'ADV-20260702-002',
  'The employee-detail response must preserve the contracted sourceReference property.',
);

console.log('HR employee-movement presentation policy verification passed.');
