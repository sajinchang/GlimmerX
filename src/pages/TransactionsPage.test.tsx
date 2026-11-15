import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { triggerIntersection } from "@/test-utils/intersectionObserver";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: {
    transactionListPaginated: vi.fn(),
    transactionCreate: vi.fn(),
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

/**
 * The virtualizer measures the scroll box, and jsdom has no layout: the
 * viewport is empty, so nothing would ever be rendered. The stub hands back
 * every item instead.
 */
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: index,
        size: 64,
        start: index * 64,
      })),
    getTotalSize: () => options.count * 64,
  }),
}));

import { TransactionsPage } from "@/pages/TransactionsPage";
import { toast } from "sonner";

const TRANSACTION = {
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
};

function page(pageNumber: number, hasNext: boolean, dates = ["2026-11-05"]) {
  return {
    items: [],
    pagination: {
      page: pageNumber,
      pageSize: 100,
      hasNext,
      hasPrev: pageNumber > 1,
    },
    dateGroups: dates.map((date) => ({
      date,
      dayTotal: 5000,
      items: [TRANSACTION],
    })),
  };
}

describe("TransactionsPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.transactionListPaginated.mockResolvedValue(page(1, false));
    api.transactionCreate.mockResolvedValue({ id: "t-new" });
    api.accountList.mockResolvedValue([]);
    api.categoryList.mockResolvedValue([]);
  });

  it("renders the search and filter bar", async () => {
    const { container } = renderWithProviders(<TransactionsPage />);

    expect(container.querySelector("input")).not.toBeNull();
  });

  it("asks for the first page of transactions", async () => {
    renderWithProviders(<TransactionsPage />);

    await screen.findByRole("textbox");
    expect(api.transactionListPaginated).toHaveBeenCalled();
    expect(api.accountList).toHaveBeenCalled();
    expect(api.categoryList).toHaveBeenCalled();
  });

  it("says so when there is no transaction", async () => {
    api.transactionListPaginated.mockResolvedValue(page(1, false, []));
    renderWithProviders(<TransactionsPage />);

    expect(await screen.findByText("暂无交易")).toBeInTheDocument();
  });

  it("says so when the search found nothing", async () => {
    api.transactionListPaginated.mockResolvedValue(page(1, false, []));
    renderWithProviders(<TransactionsPage />);

    const search = await screen.findByRole("textbox");
    fireEvent.change(search, { target: { value: "xyz" } });

    expect(await screen.findByText("未找到匹配的交易")).toBeInTheDocument();
  });

  it("reports a list it cannot read", async () => {
    api.transactionListPaginated.mockRejectedValue(new Error("读取失败"));
    renderWithProviders(<TransactionsPage />);

    expect(await screen.findByText("操作失败，请重试")).toBeInTheDocument();
  });

  it("lists the transactions", async () => {
    renderWithProviders(<TransactionsPage />);

    expect(await screen.findByText("买菜")).toBeInTheDocument();
  });

  it("asks for the next page when the reader reaches the end", async () => {
    api.transactionListPaginated.mockResolvedValueOnce(page(1, true));
    api.transactionListPaginated.mockResolvedValueOnce(page(2, false));
    renderWithProviders(<TransactionsPage />);

    await screen.findByText("买菜");
    triggerIntersection(true);

    await waitFor(() =>
      expect(api.transactionListPaginated).toHaveBeenCalledTimes(2),
    );
  });

  it("opens the form to write a transaction", async () => {
    renderWithProviders(<TransactionsPage />, { withHeaderActions: true });
    await screen.findByRole("textbox");

    fireEvent.click(
      screen
        .getByTestId("header-actions")
        .querySelector("button") as HTMLElement,
    );

    expect(await screen.findByText("创建交易")).toBeInTheDocument();
  });

  it("writes the transaction", async () => {
    api.accountList.mockResolvedValue([
      {
        id: "acc1",
        name: "现金",
        account_type: "asset",
        is_active: true,
      },
      {
        id: "acc2",
        name: "微信",
        account_type: "asset",
        is_active: true,
      },
    ]);
    renderWithProviders(<TransactionsPage />, { withHeaderActions: true });
    await screen.findByRole("textbox");

    fireEvent.click(
      screen
        .getByTestId("header-actions")
        .querySelector("button") as HTMLElement,
    );
    await screen.findByText("创建交易");

    // The form is filled in by the reader; here only the write path matters.
    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("现金");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("微信");

    const amounts = await screen.findAllByPlaceholderText("金额");
    fireEvent.change(amounts[0] as HTMLElement, { target: { value: "10.00" } });
    fireEvent.change(amounts[1] as HTMLElement, {
      target: { value: "-10.00" },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.transactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          postings: [
            expect.objectContaining({ amount: "10.00" }),
            expect.objectContaining({ amount: "-10.00" }),
          ],
        }),
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("交易创建成功");
  });

  it("reports a transaction it could not write", async () => {
    api.accountList.mockResolvedValue([
      {
        id: "acc1",
        name: "现金",
        account_type: "asset",
        is_active: true,
      },
      {
        id: "acc2",
        name: "微信",
        account_type: "asset",
        is_active: true,
      },
    ]);
    api.transactionCreate.mockRejectedValue(new Error("写不进去"));
    renderWithProviders(<TransactionsPage />, { withHeaderActions: true });
    await screen.findByRole("textbox");

    fireEvent.click(
      screen
        .getByTestId("header-actions")
        .querySelector("button") as HTMLElement,
    );
    await screen.findByText("创建交易");

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("现金");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("微信");

    const amounts = await screen.findAllByPlaceholderText("金额");
    fireEvent.change(amounts[0] as HTMLElement, { target: { value: "10.00" } });
    fireEvent.change(amounts[1] as HTMLElement, {
      target: { value: "-10.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("写不进去"));
  });
});
