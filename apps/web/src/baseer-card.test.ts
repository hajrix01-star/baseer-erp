import { describe, expect, test } from "vitest";

import { BASEER_CARD_VARIANTS, baseerCardClassName } from "./baseer-card.js";

describe("BaseerCard structural contract", () => {
  test("keeps the legacy surface defaults while exposing a bounded variant role", () => {
    expect(baseerCardClassName({})).toBe("baseer-card baseer-card--default baseer-card--default baseer-card--surface");
    expect(BASEER_CARD_VARIANTS).toEqual([
      "surface",
      "metric",
      "record",
      "chart",
      "form-or-receipt",
      "joined-ledger",
    ]);
  });

  test("keeps interactive cards compact and adds no unbounded role class", () => {
    expect(baseerCardClassName({ variant: "joined-ledger", padding: "compact", interactive: true, className: "ledger" }))
      .toBe("baseer-card baseer-card--default baseer-card--compact baseer-card--joined-ledger baseer-card--interactive ledger");
  });
});
