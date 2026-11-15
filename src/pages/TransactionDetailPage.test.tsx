import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: {
    transactionDetail: vi.fn(),
    transactionUpdate: vi.fn(),
    accountList: vi.fn(),
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

vi.mock("@/components/transactions/TransactionDeleteDialog", () => ({
  TransactionDeleteDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="delete-dialog" /> : null,
}));
vi.mock("@/components/transactions/TransactionForm", () => ({
  TransactionForm: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-form" /> : null,
}));

import { TransactionDetailPage } from "@/pages/TransactionDetailPage";

const DETAIL = {
  id: "t1",
  date: "2026-11-05",
  description: "超市采购",
  createdAt: "2026-11-05T10:00:00+08:00",
  updatedAt: "2026-11-05T10:00:00+08:00",
  isBalanced: true,
  postingCount: 2,
  debitTotal: 5000,
  creditTotal: 5000,
  postings: [
    {
      id: "p1",
      transactionId: "t1",
      accountId: "acc1",
      accountName: "现金",
      accountType: "asset",
      categoryId: "c1",
      categoryName: "餐饮",
      amount: -5000,
      amountDisplay: "¥50.00",
      isDebit: true,
      sequence: 0,
    },
    {
      id: "p2",
      transactionId: "t1",
      accountId: "c2",
      accountName: "工资",
      accountType: "income",
      categoryId: null,
      categoryName: null,
      amount: 5000,
      amountDisplay: "¥50.00",
      isDebit: false,
      sequence: 1,
    },
  ],
};

function renderPage() {
  return renderWithProviders(<TransactionDetailPage />, {
    path: "/transactions/:id",
    route: "/transactions/t1",
  });
}

describe("TransactionDetailPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.transactionDetail.mockResolvedValue(DETAIL);
    api.transactionUpdate.mockResolvedValue(DETAIL);
    api.accountList.mockResolvedValue([]);
    api.categoryList.mockResolvedValue([]);
  });

  it("shows the transaction and its postings", async () => {
    renderPage();

    expect((await screen.findAllByText("超市采购")).length).toBeGreaterThan(0);
    expect(screen.getByText("餐饮")).toBeInTheDocument();
    // A posting without a category names the ledger account behind it.
    expect(screen.getByText("收入")).toBeInTheDocument();
    expect(screen.getByText("分类")).toBeInTheDocument();
    expect(screen.getByText("借方")).toBeInTheDocument();
    expect(screen.getByText("贷方")).toBeInTheDocument();
    expect(screen.getAllByText("¥50.00").length).toBeGreaterThan(0);
  });

  it("says so when the transaction does not add up", async () => {
    api.transactionDetail.mockResolvedValue({
      ...DETAIL,
      isBalanced: false,
    });
    renderPage();

    expect(await screen.findByText(/不平衡/)).toBeInTheDocument();
  });

  it("names a transaction without a description", async () => {
    api.transactionDetail.mockResolvedValue({ ...DETAIL, description: "" });
    renderPage();

    expect((await screen.findAllByText("无描述")).length).toBeGreaterThan(0);
  });

  it("opens the edit form", async () => {
    renderPage();
    await screen.findAllByText("超市采购");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    expect(await screen.findByTestId("edit-form")).toBeInTheDocument();
  });

  it("opens the delete dialog", async () => {
    renderPage();
    await screen.findAllByText("超市采购");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(await screen.findByTestId("delete-dialog")).toBeInTheDocument();
  });

  it("reports a transaction it cannot read", async () => {
    api.transactionDetail.mockRejectedValue(new Error("读取失败"));
    renderPage();

    expect(await screen.findByText("读取失败")).toBeInTheDocument();
  });

  it("says so when the transaction is gone", async () => {
    api.transactionDetail.mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText("交易不存在")).toBeInTheDocument();
  });

  it("goes back to the list", async () => {
    renderPage();
    await screen.findAllByText("超市采购");

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    // The route only knows this page, so leaving it empties the view.
    await waitFor(() => expect(screen.queryByText("超市采购")).toBeNull());
  });
});
