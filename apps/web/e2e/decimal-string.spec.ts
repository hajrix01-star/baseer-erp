import { expect, test } from "@playwright/test";

import { addMoneyDecimals, normalizeMoneyDecimal, subtractMoneyDecimals } from "../src/decimal-string";

test("money decimal arithmetic preserves Decimal(18,4) precision", () => {
  expect(normalizeMoneyDecimal("90071992547409.0001")).toBe("90071992547409.0001");
  expect(addMoneyDecimals("90071992547409.0001", "0.0001")).toBe("90071992547409.0002");
  expect(subtractMoneyDecimals("90071992547409.0002", "0.0001")).toBe("90071992547409.0001");
  expect(() => addMoneyDecimals("99999999999999.9999", "0.0001")).toThrow(/precision/i);
});
