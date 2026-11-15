import { describe, it, expect } from "vitest";
import {
  centsToYuan,
  yuanToCents,
  formatAmount,
  formatAmountString,
  formatAmountWithSign,
} from "@/utils/format";

describe("centsToYuan", () => {
  it("converts 0 cents to 0 yuan", () => {
    expect(centsToYuan(0)).toBe(0);
  });

  it("converts 10000 cents to 100 yuan", () => {
    expect(centsToYuan(10000)).toBe(100);
  });

  it("handles negative values", () => {
    expect(centsToYuan(-5000)).toBe(-50);
  });
});

describe("yuanToCents", () => {
  it("converts empty string to 0", () => {
    expect(yuanToCents("")).toBe(0);
  });

  it("converts 100 yuan to 10000 cents", () => {
    expect(yuanToCents("100")).toBe(10000);
  });

  it("handles decimal values", () => {
    expect(yuanToCents("9.99")).toBe(999);
  });
});

describe("formatAmount", () => {
  it("formats zero amount with CNY symbol", () => {
    expect(formatAmount(0)).toBe("¥0.00");
  });

  it("formats positive amount with symbol", () => {
    expect(formatAmount(123456)).toBe("¥1,234.56");
  });

  it("puts the sign before the symbol, not between symbol and digits", () => {
    expect(formatAmount(-5000)).toBe("-¥50.00");
    expect(formatAmount(-1)).toBe("-¥0.01");
  });

  it("always uses the CNY symbol — the ledger has one currency", () => {
    // No currency argument exists; this guards against reintroducing one.
    expect(formatAmount(10000)).toBe("¥100.00");
  });
});

describe("formatAmountWithSign", () => {
  it("formats zero without sign", () => {
    expect(formatAmountWithSign(0)).toBe("¥0.00");
  });

  it("adds + prefix for positive", () => {
    expect(formatAmountWithSign(10000)).toBe("+¥100.00");
  });

  it("shows negative sign without extra prefix", () => {
    expect(formatAmountWithSign(-5000)).toBe("-¥50.00");
  });
});

describe("formatAmountString", () => {
  it("formats the decimal strings the backend returns", () => {
    expect(formatAmountString("18.5")).toBe("¥18.50");
    expect(formatAmountString("18.50")).toBe("¥18.50");
    expect(formatAmountString("1850.00")).toBe("¥1,850.00");
    expect(formatAmountString("0")).toBe("¥0.00");
  });

  it("shows an unparseable amount instead of pretending it is zero", () => {
    // A silently wrong "¥0.00" on a receipt is worse than a visibly odd one.
    expect(formatAmountString("about 20")).toBe("¥about 20");
  });

  it("renders nothing for a missing amount", () => {
    expect(formatAmountString(undefined)).toBe("");
    expect(formatAmountString("")).toBe("");
  });
});
