import type { QueryClient } from "@tanstack/react-query";

/**
 * Every query key whose data changes when a transaction or an account moves.
 *
 * This lives in one place because it already drifted: the list used to be
 * hand-written at five call sites, and one of them checked
 * `"dashboardSummary"` while the dashboard's key is `"dashboard-summary"`, so
 * that rule could never fire. With `staleTime: 0` a miss is invisible — the
 * page remounts and refetches anyway — which is precisely why the mistake
 * survived: nothing ever failed loudly.
 *
 * Keys are invalidated by prefix, so `"accounts"` also covers
 * `["accounts", "balance-sheet"]` and `"categoryList"` covers
 * `["categoryList", "expense"]`.
 */
const LEDGER_KEYS = [
  "transactionListPaginated",
  "transactionDetail",
  // `accountList`/`categoryList` are the flat list keys some pages use
  // directly, alongside the `accounts`/`categoryList` hook keys.
  "accountList",
  "accounts",
  "categoryList",
  "dashboard-summary",
  "dashboard-monthly-chart",
  "budgetStatuses",
  "standardReport",
] as const;

/** Mark everything derived from the ledger as stale. */
export function invalidateLedger(queryClient: QueryClient): void {
  for (const key of LEDGER_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}
