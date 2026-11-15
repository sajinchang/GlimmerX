import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: {
    budgetListStatuses: vi.fn(),
    budgetCreate: vi.fn(),
    budgetUpdate: vi.fn(),
    budgetDelete: vi.fn(),
    categoryList: vi.fn(),
  },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

import { BudgetsPage } from "@/pages/BudgetsPage";
import { toast } from "sonner";

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
];

const CATEGORIES = [{ id: "c1", name: "餐饮", type: "expense", icon: "🍚" }];

describe("BudgetsPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.budgetListStatuses.mockResolvedValue(BUDGETS);
    api.budgetCreate.mockResolvedValue(BUDGETS[0]);
    api.budgetUpdate.mockResolvedValue(BUDGETS[0]);
    api.budgetDelete.mockResolvedValue(undefined);
    api.categoryList.mockResolvedValue(CATEGORIES);
  });

  it("shows the budgets of the month", async () => {
    renderWithProviders(<BudgetsPage />);

    expect(await screen.findByText("餐饮")).toBeInTheDocument();
    expect(screen.getByText("¥400.00")).toBeInTheDocument();
    expect(screen.getByText("¥1,000.00")).toBeInTheDocument();
  });

  it("says so when there is no budget", async () => {
    api.budgetListStatuses.mockResolvedValue([]);
    renderWithProviders(<BudgetsPage />);

    expect(
      await screen.findByText("暂无预算，点击上方按钮添加"),
    ).toBeInTheDocument();
  });

  it("creates a budget from the header", async () => {
    renderWithProviders(<BudgetsPage />, { withHeaderActions: true });
    await screen.findByText("餐饮");

    fireEvent.click(
      within(screen.getByTestId("header-actions")).getByText("添加预算"),
    );
    expect(await screen.findByText("创建预算")).toBeInTheDocument();

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("餐饮");
    fireEvent.change(document.querySelector("#amount") as HTMLInputElement, {
      target: { value: "300.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.budgetCreate).toHaveBeenCalledWith({
        categoryId: "c1",
        amount: "300.00",
        period: "monthly",
        rollover: false,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("预算创建成功");
  });

  it("edits a budget", async () => {
    renderWithProviders(<BudgetsPage />);
    await screen.findByText("餐饮");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(await screen.findByText("编辑预算")).toBeInTheDocument();

    fireEvent.change(document.querySelector("#amount") as HTMLInputElement, {
      target: { value: "800.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.budgetUpdate).toHaveBeenCalledWith("b1", {
        amount: "800.00",
        period: "monthly",
        rollover: false,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("预算更新成功");
  });

  it("deletes a budget", async () => {
    renderWithProviders(<BudgetsPage />);
    await screen.findByText("餐饮");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByText("删除预算")).toBeInTheDocument();

    // The card has a delete button of its own; the dialog's is the last one.
    const deleters = screen.getAllByRole("button", { name: "删除" });
    fireEvent.click(deleters[deleters.length - 1] as HTMLElement);

    await waitFor(() => expect(api.budgetDelete).toHaveBeenCalledWith("b1"));
    expect(toast.success).toHaveBeenCalledWith("预算已删除");
  });

  it("reports a failed deletion", async () => {
    api.budgetDelete.mockRejectedValue(new Error("删除失败"));
    renderWithProviders(<BudgetsPage />);
    await screen.findByText("餐饮");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByText("删除预算");
    // The card has a delete button of its own; the dialog's is the last one.
    const deleters = screen.getAllByRole("button", { name: "删除" });
    fireEvent.click(deleters[deleters.length - 1] as HTMLElement);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("删除失败"));
  });
});
