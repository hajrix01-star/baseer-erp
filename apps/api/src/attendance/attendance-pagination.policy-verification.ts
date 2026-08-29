import assert from 'node:assert/strict';

import {
  attendanceEmployeeScheduleListQuerySchema,
  attendanceEmployeeScheduleListReceiptSchema,
} from '@baseer-erp/contracts';

const firstPage = attendanceEmployeeScheduleListQuerySchema.parse({});
assert.equal(firstPage.pageSize, 500);
assert.equal(firstPage.cursor, undefined);

const cursor = '11111111-1111-4111-8111-111111111111';
const nextCursor = '22222222-2222-4222-8222-222222222222';
assert.deepEqual(attendanceEmployeeScheduleListQuerySchema.parse({ cursor, pageSize: '25' }), { cursor, pageSize: 25 });
assert.throws(() => attendanceEmployeeScheduleListQuerySchema.parse({ pageSize: 501 }));

// A continued result must disclose its continuation. This prevents a caller
// from treating a capped page as a complete company schedule list.
assert.deepEqual(attendanceEmployeeScheduleListReceiptSchema.parse({ schedules: [], hasMore: true, nextCursor }), { schedules: [], hasMore: true, nextCursor });
assert.throws(() => attendanceEmployeeScheduleListReceiptSchema.parse({ schedules: [], hasMore: true, nextCursor: null }));

console.log('attendance pagination policy verification passed');
