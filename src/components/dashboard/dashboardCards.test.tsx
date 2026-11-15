import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AccountBalanceList } from "@/components/dashboard/AccountBalanceList";
import { BudgetOverviewCard } from "@/components/dashboard/BudgetOverviewCard";
import { RecentTransactionsCard } from "@/components/dashboard/RecentTransactionsCard";
import { MonthlyIncomeExpenseChart } from "@/components/dashboard/MonthlyIncomeExpenseChart";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: {
    accountList: vi.fn(),
    accountBalancesBatch: vi.fn(),
    budgetListStatuses: vi.fn(),
    transactionListPaginated: vi.fn(),
    dashboardMonthlyChart: vi.fn(),
  },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

// The chart is a canvas; jsdom cannot paint it, and the option it is given is
// checked by the chart's own test.
vi.mock("@/components/charts/EChart", () => ({
  EChart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} data-testid="chart" />
  ),
}));

const ACCOUNTS = [
  {
    id: "acc1",
    name: "现金",
    account_type: "asset",
    is_system: false,
    is_active: true,
  },
  {
    id: "acc2",
    name: "花呗",
    account_type: "liability",
    is_system: false,
    is_active: true,
  },
  {
    id: "acc3",
    name: "收入",
    account_type: "income",
    is_system: false,
    is_active: true,
  },
];

const BUDGETS = [
  {
    id: "b1",
    categoryId: "c1",
    amount: 100000,
    period: "monthly",
    rollover: false,
    categoryName: "餐饮",
    categoryIcon: "🍚",
    spent: 40000,
    remaining: 60000,
    overBudget: false,
    rolloverAmount: 0,
    available: 100000,
  },
  {
    id: "b2",
    categoryId: "c2",
    amount: 50000,
    period: "monthly",
    rollover: false,
    categoryName: "交通",
    categoryIcon: null,
    spent: 60000,
    remaining: -10000,
    overBudget: true,
    rolloverAmount: 0,
    available: 50000,
  },
];

const TRANSACTIONS = [
  {
    id: "t1",
    date: "2026-11-05",
    description: "买菜",
    categoryNames: ["餐饮"],
    categoryIcon: "🍚",
    postingsSummary: [],
    displayAmount: 5000,
    flowAmount: -5000,
    createdAt: "2026-11-05T10:00:00+08:00",
    updatedAt: "2026-11-05T10:00:00+08:00",
  },
  {
    id: "t2",
    date: "2026-11-06",
    description: "转账",
    categoryNames: [],
    categoryIcon: null,
    postingsSummary: [],
    displayAmount: 10000,
    flowAmount: 0,
    createdAt: "2026-11-06T10:00:00+08:00",
    updatedAt: "2026-11-06T10:00:00+08:00",
  },
];

describe("AccountBalanceList", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.accountList.mockResolvedValue(ACCOUNTS);
    api.accountBalancesBatch.mockResolvedValue([
      { id: "acc1", balance: 50000 },
      { id: "acc2", balance: -20000 },
    ]);
  });

  it("lists the asset and the liability accounts", async () => {
    renderWithProviders(<AccountBalanceList />);

    expect(await screen.findByText("现金")).toBeInTheDocument();
    expect(screen.getByText("花呗")).toBeInTheDocument();
    // An income account is not part of the balance sheet.
    expect(screen.queryByText("收入")).toBeNull();
  });

  it("folds a group away and brings it back", async () => {
    renderWithProviders(<AccountBalanceList />);
    await screen.findByText("现金");

    fireEvent.click(screen.getByRole("button", { name: /资产/ }));
    expect(screen.queryByText("现金")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /资产/ }));
    expect(screen.getByText("现金")).toBeInTheDocument();
  });

  it("says so when there is no account", async () => {
    api.accountList.mockResolvedValue([]);
    renderWithProviders(<AccountBalanceList />);

    expect(await screen.findByText("暂无资产账户")).toBeInTheDocument();
  });

  it("reports a list it cannot read", async () => {
    api.accountList.mockRejectedValue(new Error("读取失败"));
    renderWithProviders(<AccountBalanceList />);

    expect(await screen.findByText(/操作失败/)).toBeInTheDocument();
  });

  it("keeps two accounts of the same kind apart", async () => {
    api.accountList.mockResolvedValue([
      ...ACCOUNTS,
      {
        id: "acc4",
        name: "银行卡",
        account_type: "asset",
        is_system: false,
        is_active: true,
      },
    ]);
    api.accountBalancesBatch.mockResolvedValue([
      { id: "acc1", balance: -50000 },
      { id: "acc2", balance: -20000 },
    ]);
    renderWithProviders(<AccountBalanceList />);

    expect(await screen.findByText("银行卡")).toBeInTheDocument();
    expect(screen.getByText("现金")).toBeInTheDocument();
    // An asset that is in the red is coloured like an expense.
    const amount = await screen.findByText("-¥500.00");
    expect(amount.className).toContain("text-expense");
  });

  it("shows what a liability still owes", async () => {
    renderWithProviders(<AccountBalanceList />);
    await screen.findByText("花呗");

    // A liability shows what is owed as a positive number.
    expect(await screen.findByText("¥200.00")).toBeInTheDocument();
    expect(screen.getByText("待还")).toBeInTheDocument();
  });
});

describe("BudgetOverviewCard", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.budgetListStatuses.mockResolvedValue(BUDGETS);
  });

  it("lists the budgets of the month", async () => {
    renderWithProviders(<BudgetOverviewCard />);

    expect(await screen.findByText("餐饮")).toBeInTheDocument();
    expect(screen.getByText("交通")).toBeInTheDocument();
  });

  it("says when a budget is over", async () => {
    renderWithProviders(<BudgetOverviewCard />);

    expect(await screen.findByText("超支")).toBeInTheDocument();
  });

  it("says so when there is no budget", async () => {
    api.budgetListStatuses.mockResolvedValue([]);
    renderWithProviders(<BudgetOverviewCard />);

    expect(await screen.findByText("尚未设置预算")).toBeInTheDocument();
  });

  it("reports a budget list it cannot read", async () => {
    api.budgetListStatuses.mockRejectedValue(new Error("读取失败"));
    renderWithProviders(<BudgetOverviewCard />);

    expect(await screen.findByText(/操作失败/)).toBeInTheDocument();
  });

  it("keeps the card short when there are many budgets", async () => {
    api.budgetListStatuses.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        ...BUDGETS[0],
        id: `b${i}`,
        categoryName: `分类${i}`,
      })),
    );
    renderWithProviders(<BudgetOverviewCard />);

    expect(await screen.findByText("还有 2 个预算")).toBeInTheDocument();
    expect(screen.queryByText("分类5")).toBeNull();
  });
});

describe("RecentTransactionsCard", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.transactionListPaginated.mockResolvedValue({
      items: TRANSACTIONS,
      pagination: { page: 1, pageSize: 8, hasNext: false, hasPrev: false },
      dateGroups: [],
    });
  });

  it("lists the latest transactions", async () => {
    renderWithProviders(<RecentTransactionsCard />);

    expect(await screen.findByText("买菜")).toBeInTheDocument();
    expect(screen.getByText("转账")).toBeInTheDocument();
    expect(screen.getByText("11-05")).toBeInTheDocument();
  });

  it("says so when there is no transaction", async () => {
    api.transactionListPaginated.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 8, hasNext: false, hasPrev: false },
      dateGroups: [],
    });
    renderWithProviders(<RecentTransactionsCard />);

    expect(await screen.findByText("暂无交易记录")).toBeInTheDocument();
  });

  it("reports a list it cannot read", async () => {
    api.transactionListPaginated.mockRejectedValue(new Error("读取失败"));
    renderWithProviders(<RecentTransactionsCard />);

    expect(await screen.findByText(/操作失败/)).toBeInTheDocument();
  });

  it("opens a transaction when its row is pressed", async () => {
    renderWithProviders(<RecentTransactionsCard />, { path: "/" });
    await screen.findByText("买菜");

    const row = screen.getByText("买菜").closest("tr") as HTMLElement;
    fireEvent.click(row);

    // The route only knows this page, so leaving it empties the view.
    await waitFor(() => expect(screen.queryByText("买菜")).toBeNull());
  });

  it("opens a transaction with the keyboard", async () => {
    renderWithProviders(<RecentTransactionsCard />, { path: "/" });
    await screen.findByText("买菜");

    const row = screen.getByText("买菜").closest("tr") as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });

    await waitFor(() => expect(screen.queryByText("买菜")).toBeNull());
  });
});

describe("MonthlyIncomeExpenseChart", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.dashboardMonthlyChart.mockResolvedValue({
      year: 2026,
      month: 11,
      days: [
        {
          date: "2026-11-01",
          income: 100000,
          expense: 5000,
          has_transactions: true,
        },
      ],
    });
  });

  it("draws the month", async () => {
    renderWithProviders(<MonthlyIncomeExpenseChart />);

    expect(await screen.findByTestId("chart")).toBeInTheDocument();
  });

  it("says so when the month is empty", async () => {
    api.dashboardMonthlyChart.mockResolvedValue({
      year: 2026,
      month: 11,
      days: [],
    });
    renderWithProviders(<MonthlyIncomeExpenseChart />);

    expect(await screen.findByText("暂无记录")).toBeInTheDocument();
  });

  it("reports a chart it cannot read", async () => {
    api.dashboardMonthlyChart.mockRejectedValue(new Error("读取失败"));
    renderWithProviders(<MonthlyIncomeExpenseChart />);

    expect(await screen.findByText(/操作失败/)).toBeInTheDocument();
  });
});
