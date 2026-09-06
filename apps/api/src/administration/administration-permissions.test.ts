import { describe, expect, it } from "vitest";

import { effectivePermissionCodes, permissionDependencies } from "./administration-permissions.js";

describe("marketing permission dependencies", () => {
  it.each([
    "marketing.campaign.write",
    "marketing.reputation.policy.manage",
    "marketing.google-connection.manage",
    "marketing.google-ads.reporting.read",
    "marketing.google-business.profile.read",
  ])("makes %s reachable through the marketing workspace", (capability) => {
    expect(permissionDependencies(capability)).toContain("marketing.insights.read");
    expect(effectivePermissionCodes([capability])).toContain("marketing.insights.read");
  });

  it("keeps Google publishing behind the profile-read boundary", () => {
    expect(effectivePermissionCodes(["marketing.google-business.publisher"])).toEqual(expect.arrayContaining([
      "marketing.google-business.profile.read",
      "marketing.insights.read",
    ]));
  });
});
