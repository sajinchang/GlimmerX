import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ReportFilter } from "@/types";
import * as api from "@/utils/api";

/**
 * Every api export becomes a resolved `vi.fn()`. Important: they must return a
 * *promise*, because `src/i18n/index.ts` calls `setUiLanguage(...).catch(...)`
 * at module load — a bare `undefined` from an auto-mock throws on import.
 */
vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  const mocked: Record<string, unknown> = { ...actual };
  for (const [key, value] of Object.entries(actual)) {
    if (typeof value === "function") {
      // React Query v5 rejects `undefined` data, so the default is `{}`.
      mocked[key] = vi.fn().mockResolvedValue({});
    }
  }
  return mocked;
});

import { useAccountList } from "@/hooks/useAccountList";
import { useCategoryList } from "@/hooks/useCategoryList";
import { useAuditReport } from "@/hooks/useAuditReport";
import { useStandardReport } from "@/hooks/useStandardReport";
import { useTrendReport } from "@/hooks/useTrendReport";
import { useBalanceSheetReport } from "@/hooks/useBalanceSheetReport";
import { useCategoryBreakdownReport } from "@/hooks/useCategoryBreakdownReport";
import { useAccountBalanceTrendReport } from "@/hooks/useAccountBalanceTrendReport";
import { useAccountTransactionsReport } from "@/hooks/useAccountTransactionsReport";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { useMonthlyChart } from "@/hooks/useMonthlyChart";
import { useTopExpenses } from "@/hooks/useTopExpenses";
import { useCategoryBreakdown } from "@/hooks/useCategoryBreakdown";
import { useBudgetStatuses } from "@/hooks/useBudgetStatuses";
import {
  useActivityCalendar,
  ACTIVITY_DAYS,
} from "@/hooks/useActivityCalendar";

const filter = {
  dateRangePreset: "thisMonth",
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  periodGranularity: "month",
  compare: "none",
} as unknown as ReportFilter;

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

async function settled(hook: { current: { isSuccess: boolean } }) {
  await waitFor(() => expect(hook.current.isSuccess).toBe(true));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.accountList).mockResolvedValue([]);
  vi.mocked(api.categoryList).mockResolvedValue([]);
});

describe("ledger queries", () => {
  it("useAccountList calls accountList", async () => {
    const { result } = renderHook(() => useAccountList(), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.accountList).toHaveBeenCalledTimes(1);
  });

  it("useCategoryList forwards the category type", async () => {
    const { result } = renderHook(() => useCategoryList("expense"), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.categoryList).toHaveBeenCalledWith("expense");
  });
});

describe("dashboard queries", () => {
  it("useDashboardSummary asks for the current month window", async () => {
    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.dashboardSummary).toHaveBeenCalledTimes(1);
    const params = vi.mocked(api.dashboardSummary).mock.calls[0]?.[0];
    expect(params?.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params?.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("useMonthlyChart forwards year and month", async () => {
    const { result } = renderHook(() => useMonthlyChart(2026, 11), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.dashboardMonthlyChart).toHaveBeenCalledWith({
      year: 2026,
      month: 11,
    });
  });

  it("useTopExpenses forwards the limit", async () => {
    const { result } = renderHook(() => useTopExpenses(2026, 11, 5), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.dashboardTopExpenses).toHaveBeenCalledWith({
      year: 2026,
      month: 11,
      limit: 5,
    });
  });

  it("useCategoryBreakdown forwards year, month and category type", async () => {
    const { result } = renderHook(
      () => useCategoryBreakdown(2026, 11, "income"),
      { wrapper: createWrapper() },
    );
    await settled(result);
    expect(api.dashboardCategoryBreakdown).toHaveBeenCalledWith({
      year: 2026,
      month: 11,
      categoryType: "income",
    });
  });

  it("useCategoryBreakdown defaults to the current month and expenses", async () => {
    const { result } = renderHook(() => useCategoryBreakdown(), {
      wrapper: createWrapper(),
    });
    await settled(result);
    const params = vi.mocked(api.dashboardCategoryBreakdown).mock.calls[0]?.[0];
    expect(params?.categoryType).toBe("expense");
    expect(params?.year).toBe(new Date().getFullYear());
  });

  it("useBudgetStatuses forwards year and month", async () => {
    const { result } = renderHook(() => useBudgetStatuses(2026, 11), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.budgetListStatuses).toHaveBeenCalledWith(2026, 11);
  });
});

describe("report queries", () => {
  it("useAuditReport calls reportAudit", async () => {
    const { result } = renderHook(() => useAuditReport(), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.reportAudit).toHaveBeenCalledTimes(1);
  });

  it("useStandardReport forwards the filter", async () => {
    const { result } = renderHook(() => useStandardReport(filter), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.reportStandard).toHaveBeenCalledWith(filter);
  });

  it("useTrendReport forwards the filter", async () => {
    const { result } = renderHook(() => useTrendReport(filter), {
      wrapper: createWrapper(),
    });
    await settled(result);
    expect(api.reportTrend).toHaveBeenCalledWith(filter);
  });

  it("useCategoryBreakdownReport forwards filter and side", async () => {
    const { result } = renderHook(
      () => useCategoryBreakdownReport(filter, "income"),
      { wrapper: createWrapper() },
    );
    await settled(result);
    expect(api.reportCategoryBreakdown).toHaveBeenCalledWith(filter, "income");
  });

  it("useBalanceSheetReport waits for a snapshot date", async () => {
    const { result } = renderHook(() => useBalanceSheetReport(""), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(api.reportBalanceSheet).not.toHaveBeenCalled();

    const enabled = renderHook(() => useBalanceSheetReport("2026-11-15"), {
      wrapper: createWrapper(),
    });
    await settled(enabled.result);
    expect(api.reportBalanceSheet).toHaveBeenCalledWith("2026-11-15");
  });

  it("useAccountBalanceTrendReport waits for an account", async () => {
    const { result } = renderHook(
      () => useAccountBalanceTrendReport("", filter),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");

    const enabled = renderHook(
      () => useAccountBalanceTrendReport("acc-1", filter),
      { wrapper: createWrapper() },
    );
    await settled(enabled.result);
    expect(api.reportAccountBalanceTrend).toHaveBeenCalledWith("acc-1", filter);
  });

  it("useAccountTransactionsReport waits for an account", async () => {
    const { result } = renderHook(
      () => useAccountTransactionsReport("", filter),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");

    const enabled = renderHook(
      () => useAccountTransactionsReport("acc-1", filter),
      { wrapper: createWrapper() },
    );
    await settled(enabled.result);
    expect(api.reportAccountTransactions).toHaveBeenCalled();
  });
});

describe("useActivityCalendar", () => {
  it("builds 13 weeks of cells from the transaction list", async () => {
    const today = new Date();
    const iso = [
      today.toISOString().slice(0, 10),
      new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10),
    ];
    vi.mocked(api.transactionList).mockResolvedValue(
      iso.map((date) => ({ date }) as never),
    );

    const { result } = renderHook(() => useActivityCalendar(), {
      wrapper: createWrapper(),
    });
    await settled(result);

    const data = result.current.data;
    expect(data?.cells).toHaveLength(ACTIVITY_DAYS);
    expect(data?.total).toBe(2);
    expect(data?.max).toBeGreaterThanOrEqual(1);
    expect(data?.daysSinceLastEntry).toBeGreaterThanOrEqual(0);
    expect(data?.weekLabels).toHaveLength(3);
  });

  it("reports null days-since-entry for an empty ledger", async () => {
    vi.mocked(api.transactionList).mockResolvedValue([]);

    const { result } = renderHook(() => useActivityCalendar(), {
      wrapper: createWrapper(),
    });
    await settled(result);

    expect(result.current.data?.daysSinceLastEntry).toBeNull();
    expect(result.current.data?.total).toBe(0);
  });
});
