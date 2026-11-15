import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { invalidateLedger } from "./invalidateLedger";

/**
 * Pins every key the ledger feeds. The list used to be written by hand at five
 * call sites; one of them used `"dashboardSummary"` while the real key is
 * `"dashboard-summary"`, so that rule silently never fired. A test is the only
 * thing that makes a wrong key fail.
 */
describe("invalidateLedger", () => {
  const keys: unknown[][] = [
    ["transactionListPaginated", 1],
    ["transactionDetail", "tx-1"],
    ["accountList"],
    // Sub-keys: invalidation is by prefix.
    ["accounts", "balance-sheet"],
    ["categoryList", "expense"],
    ["dashboard-summary", "2026-11-01", "2026-11-30"],
    ["dashboard-monthly-chart", 2026, 11],
    ["budgetStatuses", 2026, 11],
    ["standardReport", { from: "2026-11-01", to: "2026-11-30" }],
  ];

  it("marks every ledger-derived query as stale", () => {
    const queryClient = new QueryClient();

    for (const key of keys) {
      queryClient.setQueryData(key, { ok: true });
    }

    invalidateLedger(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated, key.join("/")).toBe(
        true,
      );
    }
  });

  it("leaves unrelated queries alone", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["mcpConfig"], { ok: true });

    invalidateLedger(queryClient);

    // Credentials and settings are not derived from the ledger; refetching
    // them on every write would be noise.
    expect(queryClient.getQueryState(["mcpConfig"])?.isInvalidated).toBe(false);
  });
});
