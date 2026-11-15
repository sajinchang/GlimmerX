import { describe, it, expect } from "vitest";
import {
  parseAmountToCents,
  hasExcessPrecision,
  MAX_AMOUNT_CENTS,
} from "./money";
// The same file the Rust test reads (src-tauri/src/utils/money.rs), so the two
// parsers cannot silently disagree.
import moneyFixture from "../../fixtures/money-cases.json";

/**
 * The form gates submission with this parser while the backend stores what
 * `src-tauri/src/utils/money.rs` produces, so any divergence means either a
 * legal transaction that cannot be saved or an illegal one that is rejected
 * after the user pressed save.
 *
 * The cases below are local flavour; the rows that matter for agreement live in
 * `fixtures/money-cases.json` and are read by both suites. Add shared cases
 * there, not here.
 */
describe("parseAmountToCents", () => {
  it("parses the inputs the form produces", () => {
    expect(parseAmountToCents("12.50")).toBe(1250);
    expect(parseAmountToCents("100")).toBe(10000);
    expect(parseAmountToCents("-3.99")).toBe(-399);
    expect(parseAmountToCents("+1.25")).toBe(125);
    expect(parseAmountToCents(" 12.50 ")).toBe(1250);
    expect(parseAmountToCents(".50")).toBe(50);
    expect(parseAmountToCents("1.")).toBe(100);
    expect(parseAmountToCents("0")).toBe(0);
  });

  it("rounds the third decimal away from zero exactly like the backend", () => {
    // The old float-based helper rounded `2.675` to 267 here and 268 in Rust,
    // which made a balanced transaction look unbalanced and vice versa.
    expect(parseAmountToCents("2.675")).toBe(268);
    expect(parseAmountToCents("-2.675")).toBe(-268);
    expect(parseAmountToCents("0.005")).toBe(1);
    expect(parseAmountToCents("0.004")).toBe(0);
    expect(parseAmountToCents("12.345")).toBe(1235);
  });

  it("rejects what the backend rejects", () => {
    for (const value of [
      "",
      "   ",
      "abc",
      "1,000",
      "1.2.3",
      "--1",
      "+-1",
      "1.2a",
      ".",
      "-",
      "1e5",
      "NaN",
      "inf",
      "9".repeat(30),
    ]) {
      expect(
        parseAmountToCents(value),
        `expected ${value} to be rejected`,
      ).toBeNull();
    }
  });

  it("enforces the shared upper bound", () => {
    expect(parseAmountToCents(`${MAX_AMOUNT_CENTS / 100}.00`)).toBe(
      MAX_AMOUNT_CENTS,
    );
    expect(parseAmountToCents(`${MAX_AMOUNT_CENTS / 100 + 1}.00`)).toBeNull();
    expect(parseAmountToCents(`${MAX_AMOUNT_CENTS / 100 + 1}.00`)).toBeNull();
  });
});

describe("hasExcessPrecision", () => {
  it("flags more than two decimals and exponent notation", () => {
    expect(hasExcessPrecision("12.50")).toBe(false);
    expect(hasExcessPrecision("12")).toBe(false);
    expect(hasExcessPrecision("12.505")).toBe(true);
    expect(hasExcessPrecision("1e5")).toBe(true);
  });
});

describe("shared money fixture", () => {
  // Mirrors `test_shared_fixture_agrees_with_frontend` in money.rs.
  it("agrees with the backend on every row", () => {
    expect(moneyFixture.cases.length).toBeGreaterThan(0);

    for (const testCase of moneyFixture.cases) {
      const actual = parseAmountToCents(testCase.input);
      // `toBe` uses Object.is, which is what we want here: a `-0` leaking out
      // of the parser is a real (if quiet) disagreement with Rust.
      expect(
        actual,
        `${JSON.stringify(testCase.input)} (${testCase.why})`,
      ).toBe(testCase.cents);
    }
  });
});
