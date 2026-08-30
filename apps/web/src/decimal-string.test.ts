import { describe, expect, test } from "vitest";

import {
  absoluteMoneyDecimal,
  addMoneyDecimals,
  compareMoneyDecimals,
  divideMoneyDecimalByInteger,
  normalizeMoneyDecimal,
  subtractMoneyDecimals,
  sumMoneyDecimals,
} from "./decimal-string.js";

describe("decimal money operations", () => {
  test("normalizes money without using floating-point values", () => {
    expect(normalizeMoneyDecimal("12.5")).toBe("12.5000");
    expect(addMoneyDecimals("0.1", "0.2")).toBe("0.3000");
    expect(subtractMoneyDecimals("1.0000", "0.3333")).toBe("0.6667");
  });

  test("preserves exact totals and comparisons", () => {
    expect(sumMoneyDecimals(["10", "0.125", "2.875"])).toBe("13.0000");
    expect(compareMoneyDecimals("9.9999", "10")).toBe(-1);
    expect(absoluteMoneyDecimal("-42.5")).toBe("42.5000");
    expect(divideMoneyDecimalByInteger("10", 4)).toBe("2.5000");
  });

  test("rejects money values outside the ERP decimal contract", () => {
    expect(() => normalizeMoneyDecimal("1.00000")).toThrow("Invalid decimal string");
    expect(() => normalizeMoneyDecimal("-1")).toThrow("Invalid decimal string");
    expect(() => divideMoneyDecimalByInteger("1", 0)).toThrow("Invalid divisor");
  });
});
