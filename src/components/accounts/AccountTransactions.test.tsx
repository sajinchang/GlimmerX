import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AccountTransactions } from "@/components/accounts/AccountTransactions";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: { accountTransactions: vi.fn() },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const TRANSACTIONS = [
  {
    id: "t1",
    date: "2026-11-05",
    description: "买菜",
    category_id: "c1",
    amount: -5000,
    created_at: "2026-11-05T10:00:00+08:00",
    updated_at: "2026-11-05T10:00:00+08:00",
  },
  {
    id: "t2",
    date: "2026-11-06",
    description: "发工资",
    category_id: null,
    amount: 100000,
    created_at: "2026-11-06T10:00:00+08:00",
    updated_at: "2026-11-06T10:00:00+08:00",
  },
];

function renderDialog(onOpenChange = vi.fn()) {
  const view = renderWithProviders(
    <AccountTransactions
      accountId="acc1"
      accountName="现金"
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { ...view, onOpenChange };
}

describe("AccountTransactions", () => {
  beforeEach(() => {
    api.accountTransactions.mockReset();
    api.accountTransactions.mockResolvedValue(TRANSACTIONS);
  });

  it("lists the transactions of the account", async () => {
    renderDialog();

    expect(await screen.findByText("买菜")).toBeInTheDocument();
    expect(screen.getByText("发工资")).toBeInTheDocument();
    expect(screen.getByText("-¥50.00")).toBeInTheDocument();
    expect(screen.getByText("¥1,000.00")).toBeInTheDocument();
  });

  it("says so when the account has not moved", async () => {
    api.accountTransactions.mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByText("暂无交易记录")).toBeInTheDocument();
  });

  it("asks the backend again when the filter is applied", async () => {
    renderDialog();
    await screen.findByText("买菜");

    api.accountTransactions.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));

    await waitFor(() => expect(api.accountTransactions).toHaveBeenCalled());
  });

  it("clears the date range", async () => {
    renderDialog();
    await screen.findByText("买菜");

    // Pick a day in the calendar, then clear the range again.
    fireEvent.click(screen.getAllByText("开始日期")[1] as HTMLElement);
    const day = Array.from(
      document.querySelectorAll<HTMLElement>('[role="gridcell"] button'),
    ).find((button) => button.textContent === "15");
    fireEvent.click(day as HTMLElement);
    await waitFor(() =>
      expect(api.accountTransactions).toHaveBeenCalledWith(
        "acc1",
        expect.any(String),
        undefined,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(screen.getAllByText("开始日期").length).toBe(2);
  });

  it("closes when the reader is done", async () => {
    const { onOpenChange } = renderDialog();
    await screen.findByText("买菜");

    // The dialog frame has a close button of its own; the footer one is last.
    const close = screen.getAllByRole("button", { name: "关闭" });
    fireEvent.click(close[close.length - 1] as HTMLElement);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
