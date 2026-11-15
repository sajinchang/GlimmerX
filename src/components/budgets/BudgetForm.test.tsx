import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { BudgetForm } from "@/components/budgets/BudgetForm";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";
import type { BudgetStatus, Category } from "@/types";

const { api } = vi.hoisted(() => ({
  api: { categoryList: vi.fn() },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

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
    name: "工资",
    type: "income",
    icon: null,
    accountId: "acc1",
    balance: 0,
    createdAt: "2026-11-01T00:00:00+08:00",
    updatedAt: "2026-11-01T00:00:00+08:00",
  },
];

const BUDGET: BudgetStatus = {
  id: "b1",
  categoryId: "c1",
  amount: 100000,
  period: "monthly",
  rollover: true,
  categoryName: "餐饮",
  categoryIcon: "🍚",
  spent: 0,
  remaining: 100000,
  overBudget: false,
  rolloverAmount: 0,
  available: 100000,
};

function renderForm(
  props: Partial<React.ComponentProps<typeof BudgetForm>> = {},
) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <BudgetForm
      open
      onOpenChange={onOpenChange}
      mode="create"
      onSubmit={onSubmit}
      isLoading={false}
      {...props}
    />,
  );
  return { ...view, onSubmit, onOpenChange };
}

describe("BudgetForm", () => {
  beforeEach(() => {
    api.categoryList.mockReset();
    api.categoryList.mockResolvedValue(CATEGORIES);
  });

  it("asks for the category and the amount", async () => {
    renderForm();

    expect(await screen.findByText("创建预算")).toBeInTheDocument();
    expect(screen.getByLabelText("分类")).toBeInTheDocument();
    expect(screen.getByLabelText("预算金额")).toBeInTheDocument();
    expect(screen.getByLabelText("周期")).toBeInTheDocument();
    expect(screen.getByLabelText("结余滚存")).toBeInTheDocument();
  });

  it("creates a budget", async () => {
    const { onSubmit } = renderForm();
    await screen.findByText("创建预算");

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("餐饮");

    fireEvent.change(document.querySelector("#amount") as HTMLInputElement, {
      target: { value: "500.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        categoryId: "c1",
        amount: "500.00",
        period: "monthly",
        rollover: false,
      }),
    );
  });

  it("refuses a budget without a category", async () => {
    const { onSubmit } = renderForm();
    await screen.findByText("创建预算");

    fireEvent.change(document.querySelector("#amount") as HTMLInputElement, {
      target: { value: "500.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it("refuses an amount that is not money", async () => {
    const { onSubmit } = renderForm();
    await screen.findByText("创建预算");

    fireEvent.change(document.querySelector("#amount") as HTMLInputElement, {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it("shows what the budget already is when it is edited", async () => {
    renderForm({ mode: "edit", budget: BUDGET });

    expect(await screen.findByText("编辑预算")).toBeInTheDocument();
    expect((document.querySelector("#amount") as HTMLInputElement).value).toBe(
      "1000",
    );
    expect(screen.getByText("餐饮")).toBeInTheDocument();
    // The category cannot be changed once the budget exists.
    expect(screen.queryByLabelText("分类")).toBeNull();
  });

  it("updates a budget", async () => {
    const { onSubmit } = renderForm({ mode: "edit", budget: BUDGET });
    await screen.findByText("编辑预算");

    fireEvent.change(document.querySelector("#amount") as HTMLInputElement, {
      target: { value: "800.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        amount: "800.00",
        period: "monthly",
        rollover: true,
      }),
    );
  });

  it("switches the period and the rollover", async () => {
    const { onSubmit } = renderForm();
    await screen.findByText("创建预算");

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("餐饮");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("周度");

    fireEvent.click(screen.getByLabelText("结余滚存"));
    fireEvent.change(document.querySelector("#amount") as HTMLInputElement, {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        categoryId: "c1",
        amount: "10",
        period: "weekly",
        rollover: true,
      }),
    );
  });

  it("closes without saving", async () => {
    const { onOpenChange } = renderForm();
    await screen.findByText("创建预算");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
