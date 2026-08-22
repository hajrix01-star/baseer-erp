import { expect, test } from "@playwright/test";

import { addMoneyDecimals, compareMoneyDecimals, divideMoneyDecimalByInteger, normalizeMoneyDecimal, subtractMoneyDecimals, sumMoneyDecimals } from "../src/decimal-string";

test("money decimal arithmetic preserves Decimal(18,4) precision", () => {
  expect(normalizeMoneyDecimal("90071992547409.0001")).toBe("90071992547409.0001");
  expect(addMoneyDecimals("90071992547409.0001", "0.0001")).toBe("90071992547409.0002");
  expect(subtractMoneyDecimals("90071992547409.0002", "0.0001")).toBe("90071992547409.0001");
  expect(() => addMoneyDecimals("99999999999999.9999", "0.0001")).toThrow(/precision/i);
});

test("money decimal comparisons, allocation sums, and count averages avoid floats", () => {
  expect(normalizeMoneyDecimal("0002.5")).toBe("2.5000");
  expect(sumMoneyDecimals(["0.1000", "0.2000", "0.3000"])).toBe("0.6000");
  expect(compareMoneyDecimals("0.3000", "0.3")).toBe(0);
  expect(divideMoneyDecimalByInteger("1.0000", 3)).toBe("0.3333");
});
