import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: {
    categoryList: vi.fn(),
    categoryCreate: vi.fn(),
    categoryUpdate: vi.fn(),
    categoryDelete: vi.fn(),
    categoryDeletePreview: vi.fn(),
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

import { CategoriesPage } from "@/pages/CategoriesPage";
import { toast } from "sonner";

const CATEGORIES = [
  {
    id: "c1",
    name: "工资",
    type: "income",
    icon: null,
    balance: 100000,
    is_system: false,
    parent_id: null,
    created_at: "2026-01-01T00:00:00+08:00",
    updated_at: "2026-01-01T00:00:00+08:00",
  },
  {
    id: "c2",
    name: "餐饮",
    type: "expense",
    icon: "🍚",
    balance: 5000,
    is_system: false,
    parent_id: null,
    created_at: "2026-01-01T00:00:00+08:00",
    updated_at: "2026-01-01T00:00:00+08:00",
  },
];

function rowOf(name: string) {
  const row = screen.getByText(name).closest("div.justify-between");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("CategoriesPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.categoryList.mockResolvedValue(CATEGORIES);
    api.categoryCreate.mockResolvedValue(CATEGORIES[0]);
    api.categoryUpdate.mockResolvedValue(CATEGORIES[0]);
    api.categoryDelete.mockResolvedValue(undefined);
    api.categoryDeletePreview.mockResolvedValue({
      categoryId: "c2",
      transactionCount: 3,
      budgetCount: 0,
    });
  });

  it("shows the income and the expense categories apart", async () => {
    renderWithProviders(<CategoriesPage />);

    expect(await screen.findByText("工资")).toBeInTheDocument();
    expect(screen.getByText("餐饮")).toBeInTheDocument();
    expect(screen.getByText("¥1,000.00")).toBeInTheDocument();
    expect(screen.getByText("¥50.00")).toBeInTheDocument();
  });

  it("says so when there is no category at all", async () => {
    api.categoryList.mockResolvedValue([]);
    renderWithProviders(<CategoriesPage />);

    expect(await screen.findByText("暂无收入分类")).toBeInTheDocument();
    expect(screen.getByText("暂无支出分类")).toBeInTheDocument();
  });

  it("creates a category", async () => {
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("工资");

    fireEvent.click(screen.getAllByText("添加分类")[1] as HTMLElement);
    expect(await screen.findByText("新建分类")).toBeInTheDocument();

    fireEvent.change(
      document.querySelector("#category-name") as HTMLInputElement,
      { target: { value: "购物" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.categoryCreate).toHaveBeenCalledWith({
        name: "购物",
        type: "expense",
        icon: undefined,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("分类创建成功");
  });

  it("edits a category", async () => {
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("餐饮");

    const buttons = rowOf("餐饮").querySelectorAll("button");
    fireEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findByText("编辑分类")).toBeInTheDocument();

    fireEvent.change(
      document.querySelector("#category-name") as HTMLInputElement,
      { target: { value: "吃饭" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.categoryUpdate).toHaveBeenCalledWith("c2", {
        name: "吃饭",
        icon: undefined,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("分类更新成功");
  });

  it("deletes a category", async () => {
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("餐饮");

    const buttons = rowOf("餐饮").querySelectorAll("button");
    fireEvent.click(buttons[1] as HTMLElement);

    expect(await screen.findByText("确认删除分类")).toBeInTheDocument();
    await waitFor(() => expect(api.categoryDeletePreview).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(api.categoryDelete).toHaveBeenCalledWith("c2"));
    expect(toast.success).toHaveBeenCalledWith("分类删除成功");
  });

  it("keeps a category that a budget uses", async () => {
    api.categoryDeletePreview.mockResolvedValue({
      categoryId: "c2",
      transactionCount: 3,
      budgetCount: 1,
    });
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("餐饮");

    const buttons = rowOf("餐饮").querySelectorAll("button");
    fireEvent.click(buttons[1] as HTMLElement);

    await screen.findByText("确认删除分类");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "删除" })).toBeDisabled(),
    );
  });

  it("says how many transactions a category holds", async () => {
    api.categoryDeletePreview.mockResolvedValue({
      categoryId: "c2",
      transactionCount: 3,
      budgetCount: 0,
    });
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("餐饮");

    const buttons = rowOf("餐饮").querySelectorAll("button");
    fireEvent.click(buttons[1] as HTMLElement);

    await screen.findByText("确认删除分类");
    await waitFor(() =>
      expect(screen.getByText(/3 个交易记录/)).toBeInTheDocument(),
    );
  });

  it("reports a failed preview", async () => {
    api.categoryDeletePreview.mockRejectedValue(new Error("预览失败"));
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("餐饮");

    const buttons = rowOf("餐饮").querySelectorAll("button");
    fireEvent.click(buttons[1] as HTMLElement);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("预览失败"));
  });

  it("reports a failed deletion", async () => {
    api.categoryDelete.mockRejectedValue(new Error("删除失败"));
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("餐饮");

    const buttons = rowOf("餐饮").querySelectorAll("button");
    fireEvent.click(buttons[1] as HTMLElement);
    await screen.findByText("确认删除分类");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "删除" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("删除失败"));
  });

  it("keeps the category when the deletion is called off", async () => {
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("餐饮");

    const buttons = rowOf("餐饮").querySelectorAll("button");
    fireEvent.click(buttons[1] as HTMLElement);
    await screen.findByText("确认删除分类");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByText("确认删除分类")).toBeNull());
    expect(api.categoryDelete).not.toHaveBeenCalled();
  });

  it("says what is lost when the category holds nothing", async () => {
    api.categoryDeletePreview.mockResolvedValue({
      categoryId: "c2",
      transactionCount: 0,
      budgetCount: 0,
    });
    renderWithProviders(<CategoriesPage />);
    await screen.findByText("餐饮");

    const buttons = rowOf("餐饮").querySelectorAll("button");
    fireEvent.click(buttons[1] as HTMLElement);

    expect(await screen.findByText(/确定要删除/)).toBeInTheDocument();
  });
});
