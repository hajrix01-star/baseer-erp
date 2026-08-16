import assert from "node:assert/strict";

const { SignInRateLimitService } = await import("../apps/api/dist/identity/sign-in-rate-limit.service.js");

const limiter = new SignInRateLimitService();
const key = limiter.key("Baseer-Test", "owner@baseer.test");
for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure(key);
assert.throws(() => limiter.assertAllowed(key), /Too many sign-in attempts/);

const recoveredKey = limiter.key("Baseer-Test", "recovered@baseer.test");
limiter.recordFailure(recoveredKey);
limiter.recordSuccess(recoveredKey);
assert.doesNotThrow(() => limiter.assertAllowed(recoveredKey));

console.log("Authentication rate-limit verification passed: repeated failures are blocked and a successful sign-in clears its own attempt window.");