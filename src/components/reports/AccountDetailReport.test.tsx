import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AccountDetailReport } from "@/components/reports/AccountDetailReport";
import { renderWithProviders } from "@/test-utils/render";
import { createReportController } from "@/test-utils/reportController";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: {
    accountList: vi.fn(),
    reportAccountTransactions: vi.fn(),
    reportAccountBalanceTrend: vi.fn(),
  },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const { charts } = vi.hoisted(() => ({ charts: [] as unknown[] }));

vi.mock("@/components/charts/EChart", async () => {
  const React = await import("react");
  return {
    EChart: (props: { label: string; option: unknown }) => {
      charts.push(props);
      return React.createElement("div", {
        "data-testid": "echart",
        "aria-label": props.label,
      });
    },
  };
});

const ACCOUNTS = [
  { id: "acc1", name: "现金", account_type: "asset", is_active: true },
  { id: "acc2", name: "工资", account_type: "income", is_active: true },
];

const TRANSACTIONS = {
  accountId: "acc1",
  accountName: "现金",
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  transactions: [
    {
      transactionId: "t1",
      date: "2026-11-05",
      description: "买菜",
      categoryName: "餐饮",
      counterAccountName: "工资",
      amount: 5000,
      isInflow: true,
    },
    {
      transactionId: "t2",
      date: "2026-11-06",
      description: "",
      categoryName: null,
      counterAccountName: null,
      amount: -2000,
      isInflow: false,
    },
  ],
  totalCount: 2,
  totalInflow: 5000,
  totalOutflow: 2000,
  netChange: 3000,
  totalPages: 2,
};

const TREND = {
  accountId: "acc1",
  accountName: "现金",
  granularity: "monthly",
  dataPoints: [
    {
      period: "2026-11",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      balance: 100000,
    },
  ],
};

describe("AccountDetailReport", () => {
  beforeEach(() => {
    charts.length = 0;
    for (const fn of Object.values(api)) fn.mockReset();
    api.accountList.mockResolvedValue(ACCOUNTS);
    api.reportAccountTransactions.mockResolvedValue(TRANSACTIONS);
    api.reportAccountBalanceTrend.mockResolvedValue(TREND);
  });

  it("asks the reader to pick an account", async () => {
    const { controller } = createReportController();
    renderWithProviders(<AccountDetailReport controller={controller} />);

    expect(await screen.findByText(/先选一个账户/)).toBeInTheDocument();
    expect(api.reportAccountTransactions).not.toHaveBeenCalled();
  });

  it("shows what the account did", async () => {
    const { controller } = createReportController({ accountId: "acc1" });
    renderWithProviders(<AccountDetailReport controller={controller} />);

    await waitFor(() => expect(screen.getByText("买菜")).toBeInTheDocument());
    expect(screen.getByText("餐饮")).toBeInTheDocument();
    expect(screen.getByText("工资")).toBeInTheDocument();
    // A row without a description or a counter account shows a dash.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the figures of the period", async () => {
    const { controller } = createReportController({ accountId: "acc1" });
    renderWithProviders(<AccountDetailReport controller={controller} />);

    await waitFor(() => expect(screen.getByText("买菜")).toBeInTheDocument());
    expect(screen.getByText("¥50.00")).toBeInTheDocument();
    expect(screen.getByText("¥20.00")).toBeInTheDocument();
    expect(screen.getByText("¥30.00")).toBeInTheDocument();
  });

  it("draws the balance of the account", async () => {
    const { controller } = createReportController({ accountId: "acc1" });
    renderWithProviders(<AccountDetailReport controller={controller} />);

    await waitFor(() =>
      expect(screen.getByTestId("echart")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("现金").length).toBeGreaterThan(0);
  });

  it("says so when the account has no balance to draw", async () => {
    api.reportAccountBalanceTrend.mockResolvedValue({
      ...TREND,
      dataPoints: [],
    });
    const { controller } = createReportController({ accountId: "acc1" });
    renderWithProviders(<AccountDetailReport controller={controller} />);

    await waitFor(() =>
      expect(screen.getByText("该区间没有记录")).toBeInTheDocument(),
    );
  });

  it("turns the pages of the transactions", async () => {
    const { controller } = createReportController({ accountId: "acc1" });
    renderWithProviders(<AccountDetailReport controller={controller} />);

    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());

    const pageButtons = screen.getAllByRole("button", { name: "" });
    fireEvent.click(pageButtons[pageButtons.length - 1] as HTMLElement);

    await waitFor(() =>
      expect(api.reportAccountTransactions).toHaveBeenCalledWith(
        "acc1",
        expect.anything(),
        2,
        50,
      ),
    );
  });

  it("picks another account", async () => {
    const { controller, spies } = createReportController();
    renderWithProviders(<AccountDetailReport controller={controller} />);

    await waitFor(() =>
      expect(screen.getByText(/先选一个账户/)).toBeInTheDocument(),
    );

    const trigger = screen.getAllByRole("combobox")[0] as HTMLElement;
    await openSelect(trigger);
    clickOption("现金");

    expect(spies.setAccount).toHaveBeenCalledWith("acc1");
  });

  it("reports a report it cannot read", async () => {
    api.reportAccountTransactions.mockRejectedValue(new Error("读不出来"));
    const { controller } = createReportController({ accountId: "acc1" });
    renderWithProviders(<AccountDetailReport controller={controller} />);

    expect(await screen.findByText("加载失败")).toBeInTheDocument();
  });
});
