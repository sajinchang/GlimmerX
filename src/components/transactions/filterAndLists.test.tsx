import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { TransactionFilterPanel } from "@/components/transactions/TransactionFilterPanel";
import { TopExpensesList } from "@/components/dashboard/TopExpensesList";
import { BudgetProgressCard } from "@/components/budgets/BudgetProgressCard";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";
import type { AccountDto, Category, EnhancedTransactionFilter } from "@/types";

const { api } = vi.hoisted(() => ({
  api: { dashboardTopExpenses: vi.fn() },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const ACCOUNTS: AccountDto[] = [
  {
    id: "acc1",
    name: "现金",
    account_type: "asset",
    description: "",
    account_number: null,
    is_system: false,
    iban: null,
    is_active: true,
    include_net_worth: true,
    created_at: "2026-11-01T00:00:00+08:00",
    updated_at: "2026-11-01T00:00:00+08:00",
    meta: [],
  },
];

const CATEGORIES: Category[] = [
  {
    id: "c1",
    name: "餐饮",
    type: "expense",
    icon: "🍚",
    accountId: "acc1",
    balance: 0,
    createdAt: "2026-11-01T00:00:00+08:00",
    updatedAt: "2026-11-01T00:00:00+08:00",
  },
  {
    id: "c2",
    name: "交通",
    type: "expense",
    icon: null,
    accountId: "acc1",
    balance: 0,
    createdAt: "2026-11-01T00:00:00+08:00",
    updatedAt: "2026-11-01T00:00:00+08:00",
  },
];

function renderFilter(
  filter: Partial<EnhancedTransactionFilter> = {},
  onChange = vi.fn(),
  onClearFilter = vi.fn(),
) {
  renderWithProviders(
    <TransactionFilterPanel
      filter={{
        pageSize: 100,
        sortBy: "date",
        sortOrder: "desc",
        ...filter,
      }}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      onClearFilter={onClearFilter}
      onChange={onChange}
    />,
  );
  return { onChange, onClearFilter };
}

describe("TransactionFilterPanel", () => {
  it("shows what the filter holds", () => {
    renderFilter({ minAmount: 1000, maxAmount: 5000 });

    expect(screen.getByPlaceholderText("最小")).toHaveValue(10);
    expect(screen.getByPlaceholderText("最大")).toHaveValue(50);
  });

  it("shows an empty range when the filter has none", () => {
    renderFilter();

    expect(screen.getByPlaceholderText("最小")).toHaveValue(null);
    expect(screen.getByPlaceholderText("最大")).toHaveValue(null);
  });

  it("reads the smallest amount", () => {
    const { onChange } = renderFilter();

    const min = screen.getByPlaceholderText("最小");
    fireEvent.change(min, { target: { value: "12.50" } });
    fireEvent.blur(min);

    expect(onChange).toHaveBeenCalledWith({ minAmount: 1250 });
  });

  it("takes the smallest amount away again", () => {
    const { onChange } = renderFilter({ minAmount: 1000 });

    const min = screen.getByPlaceholderText("最小");
    fireEvent.change(min, { target: { value: "" } });
    fireEvent.blur(min);

    expect(onChange).toHaveBeenCalledWith({ minAmount: undefined });
  });

  it("ignores an amount that is not money", () => {
    const { onChange } = renderFilter();

    const max = screen.getByPlaceholderText("最大");
    fireEvent.change(max, { target: { value: "-5" } });
    fireEvent.blur(max);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("reads the largest amount", () => {
    const { onChange } = renderFilter();

    const max = screen.getByPlaceholderText("最大");
    fireEvent.change(max, { target: { value: "30" } });
    fireEvent.blur(max);

    expect(onChange).toHaveBeenCalledWith({ maxAmount: 3000 });
  });

  it("takes the largest amount away again", () => {
    const { onChange } = renderFilter({ maxAmount: 1000 });

    const max = screen.getByPlaceholderText("最大");
    fireEvent.change(max, { target: { value: "" } });
    fireEvent.blur(max);

    expect(onChange).toHaveBeenCalledWith({ maxAmount: undefined });
  });

  it("picks an account", async () => {
    const { onChange } = renderFilter();

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("现金");

    expect(onChange).toHaveBeenCalledWith({ accountId: "acc1" });
  });

  it("picks a category", async () => {
    const { onChange } = renderFilter();

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("🍚 餐饮");

    expect(onChange).toHaveBeenCalledWith({ categoryId: "c1" });
  });

  it("clears the filter", () => {
    const { onClearFilter } = renderFilter({ accountId: "acc1" });

    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(onClearFilter).toHaveBeenCalled();
  });

  it("has no clear button when nothing is filtered", () => {
    renderFilter();

    expect(screen.queryByRole("button", { name: "清除" })).toBeNull();
  });
});

describe("TopExpensesList", () => {
  beforeEach(() => {
    api.dashboardTopExpenses.mockReset();
  });

  it("lists the largest expenses", async () => {
    api.dashboardTopExpenses.mockResolvedValue({
      expenses: [
        {
          posting_id: "p1",
          transaction_id: "t1",
          date: "2026-11-05",
          description: "买菜",
          category_name: "餐饮",
          amount: 5000,
        },
        {
          posting_id: "p2",
          transaction_id: "t2",
          date: "2026-11-06",
          description: "",
          category_name: null,
          amount: 2000,
        },
      ],
    });
    renderWithProviders(<TopExpensesList />);

    expect(await screen.findByText("买菜")).toBeInTheDocument();
    expect(screen.getByText("无描述")).toBeInTheDocument();
    expect(screen.getByText("¥50.00")).toBeInTheDocument();
    expect(screen.getByText("11-05")).toBeInTheDocument();
  });

  it("says so when there is no expense", async () => {
    api.dashboardTopExpenses.mockResolvedValue({ expenses: [] });
    renderWithProviders(<TopExpensesList />);

    expect(await screen.findByText("本月暂无支出")).toBeInTheDocument();
  });

  it("reports a list it cannot read", async () => {
    api.dashboardTopExpenses.mockRejectedValue(new Error("读取失败"));
    renderWithProviders(<TopExpensesList />);

    expect(await screen.findByText(/操作失败/)).toBeInTheDocument();
  });
});

describe("BudgetProgressCard", () => {
  it("shows how much of the budget is gone", () => {
    renderWithProviders(
      <BudgetProgressCard
        budget={{
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
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("餐饮")).toBeInTheDocument();
    expect(screen.getByText("¥400.00")).toBeInTheDocument();
    expect(screen.getByText("¥1,000.00")).toBeInTheDocument();
    expect(screen.getByText("¥600.00")).toBeInTheDocument();
  });

  it("says when the budget is over", () => {
    renderWithProviders(
      <BudgetProgressCard
        budget={{
          id: "b1",
          categoryId: "c1",
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
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("交通")).toBeInTheDocument();
    expect(screen.getByText("-¥100.00")).toBeInTheDocument();
  });

  it("has no progress bar when the budget is empty", () => {
    const { container } = renderWithProviders(
      <BudgetProgressCard
        budget={{
          id: "b1",
          categoryId: "c1",
          amount: 0,
          period: "monthly",
          rollover: false,
          categoryName: "餐饮",
          categoryIcon: null,
          spent: 0,
          remaining: 0,
          overBudget: false,
          rolloverAmount: 0,
          available: 0,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const bar = container.querySelector(".h-2 > div") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("edits and deletes the budget", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderWithProviders(
      <BudgetProgressCard
        budget={{
          id: "b1",
          categoryId: "c1",
          amount: 100000,
          period: "monthly",
          rollover: false,
          categoryName: "餐饮",
          categoryIcon: null,
          spent: 0,
          remaining: 100000,
          overBudget: false,
          rolloverAmount: 0,
          available: 100000,
        }}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(onEdit).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalled();
  });
});
