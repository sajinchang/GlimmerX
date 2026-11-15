import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

/**
 * Fixtures live inside `vi.hoisted` because `vi.mock` is hoisted above the
 * imports — a plain module-level object would still be in its temporal dead
 * zone when the factory runs.
 */
const { responses } = vi.hoisted(() => {
  const summary = {
    month_income: 500000,
    month_expense: 320000,
    month_start: "2026-11-01",
    month_end: "2026-11-30",
    year_income: 6000000,
    year_expense: 4100000,
    year_start: "2026-01-01",
    year_end: "2026-12-31",
    total_assets: 2500000,
    total_liabilities: 800000,
    net_worth: 1700000,
    calculated_at: "2026-11-15T10:00:00+08:00",
  };

  const monthly = {
    year: 2026,
    month: 11,
    days: [
      { date: "2026-11-10", income: 0, expense: 12000, has_transactions: true },
    ],
    month_total_income: 500000,
    month_total_expense: 320000,
  };

  const breakdown = {
    year: 2026,
    month: 11,
    category_type: "expense",
    categories: [
      {
        category_id: "cat-food",
        category_name: "餐饮",
        icon: null,
        amount: 120000,
        percentage: 60,
      },
    ],
    total_amount: 320000,
  };

  const topExpenses = {
    year: 2026,
    month: 11,
    expenses: [
      {
        posting_id: "p1",
        transaction_id: "t1",
        date: "2026-11-10",
        description: "超市采购",
        amount: 88000,
        category_id: "cat-food",
        category_name: "餐饮",
        category_icon: null,
      },
    ],
  };

  const budgets = [
    {
      id: "b1",
      categoryId: "cat-food",
      categoryName: "餐饮预算",
      categoryIcon: null,
      amount: 500000,
      period: "monthly",
      rollover: false,
      spent: 120000,
      remaining: 380000,
      overBudget: false,
      rolloverAmount: 0,
      available: 500000,
    },
  ];

  const accounts = [
    {
      id: "acc-cash",
      name: "现金账户",
      account_type: "asset",
      description: "",
      account_number: null,
      is_system: false,
      iban: null,
      is_active: true,
      include_net_worth: true,
      created_at: "2026-11-01T00:00:00+08:00",
      updated_at: "2026-11-01T00:00:00+08:00",
    },
  ];

  const recent = {
    items: [
      {
        id: "t1",
        date: "2026-11-10",
        description: "超市采购",
        categoryNames: ["餐饮"],
        categoryIcon: null,
        postingsSummary: [],
        displayAmount: 88000,
        flowAmount: -88000,
        createdAt: "2026-11-10T12:00:00+08:00",
        updatedAt: "2026-11-10T12:00:00+08:00",
      },
    ],
    pagination: { page: 1, pageSize: 100, hasNext: false },
    dateGroups: [],
  };

  return {
    responses: {
      dashboardSummary: summary,
      dashboardMonthlyChart: monthly,
      dashboardCategoryBreakdown: breakdown,
      dashboardTopExpenses: topExpenses,
      budgetListStatuses: budgets,
      accountList: accounts,
      accountBalancesBatch: [{ id: "acc-cash", balance: 123400 }],
      transactionListPaginated: recent,
      transactionList: [
        { id: "t1", date: "2026-11-10" },
        { id: "t2", date: "2026-11-11" },
      ],
    } as Record<string, unknown>,
  };
});

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  const source = actual as unknown as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...source };
  for (const key of Object.keys(source)) {
    if (typeof source[key] === "function") {
      mocked[key] = vi.fn().mockResolvedValue(responses[key] ?? {});
    }
  }
  return mocked;
});

import * as api from "@/utils/api";
import { DashboardPage } from "@/pages/DashboardPage";

describe("DashboardPage", () => {
  it("lays out the panes and renders what the queries returned", async () => {
    const { container } = renderWithProviders(<DashboardPage />);

    // Column sizing hangs off this wrapper; `min-h-0` is what keeps the three
    // columns ending on the same line.
    expect(container.querySelector('[data-print="panes"]')).not.toBeNull();

    expect((await screen.findAllByText("餐饮")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("超市采购")).length).toBeGreaterThan(0);
    expect(await screen.findByText("现金账户")).toBeInTheDocument();
    expect(await screen.findByText("餐饮预算")).toBeInTheDocument();
  });

  it("renders the empty state when the ledger has no data", async () => {
    vi.mocked(api.dashboardSummary).mockResolvedValueOnce({
      ...(responses.dashboardSummary as object),
      month_income: 0,
      month_expense: 0,
      net_worth: 0,
    } as never);
    vi.mocked(api.dashboardCategoryBreakdown).mockResolvedValueOnce({
      year: 2026,
      month: 11,
      category_type: "expense",
      categories: [],
      total_amount: 0,
    } as never);
    vi.mocked(api.dashboardTopExpenses).mockResolvedValueOnce({
      year: 2026,
      month: 11,
      expenses: [],
    } as never);
    vi.mocked(api.budgetListStatuses).mockResolvedValueOnce([]);
    vi.mocked(api.accountList).mockResolvedValueOnce([]);
    vi.mocked(api.transactionList).mockResolvedValueOnce([]);
    vi.mocked(api.transactionListPaginated).mockResolvedValueOnce({
      items: [],
      pagination: { page: 1, pageSize: 100, hasNext: false },
      dateGroups: [],
    } as never);

    const { container } = renderWithProviders(<DashboardPage />);

    // Nothing to list, but the layout must still be there — an empty ledger is
    // a normal state, not an error screen.
    expect(container.querySelector('[data-print="panes"]')).not.toBeNull();
    expect(api.dashboardSummary).toHaveBeenCalled();
    expect(api.budgetListStatuses).toHaveBeenCalled();
  });
});
