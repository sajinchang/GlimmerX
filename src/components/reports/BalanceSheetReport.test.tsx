import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { BalanceSheetReport } from "@/components/reports/BalanceSheetReport";
import { renderWithProviders } from "@/test-utils/render";
import {
  createReportController,
  type CapturedChart,
} from "@/test-utils/reportController";

const { api } = vi.hoisted(() => ({
  api: { reportBalanceSheet: vi.fn() },
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

const SHEET = {
  snapshotDate: "2026-11-15",
  assets: [
    {
      accountId: "a1",
      accountName: "现金",
      accountType: "asset",
      balance: 50000,
    },
    {
      accountId: "a2",
      accountName: "银行卡",
      accountType: "asset",
      balance: 300000,
    },
  ],
  liabilities: [
    {
      accountId: "l1",
      accountName: "信用卡",
      accountType: "liability",
      balance: -12000,
    },
  ],
  totalAssets: 350000,
  totalLiabilities: -12000,
  netWorth: 338000,
};

function statsStrip() {
  const strip = document.querySelector('[data-elevation="raise"]');
  if (!strip) throw new Error("stats strip not rendered");
  return within(strip as HTMLElement);
}

function lastChart(): CapturedChart {
  const chart = charts[charts.length - 1];
  if (!chart) throw new Error("no chart rendered");
  return chart as CapturedChart;
}

async function renderReport(
  controller: ReturnType<typeof createReportController>["controller"],
) {
  const result = renderWithProviders(
    <BalanceSheetReport controller={controller} />,
  );
  await waitFor(() => expect(screen.queryByText("加载中…")).toBeNull());
  return result;
}

describe("BalanceSheetReport", () => {
  beforeEach(() => {
    charts.length = 0;
    api.reportBalanceSheet.mockReset();
    api.reportBalanceSheet.mockResolvedValue(SHEET);
  });

  it("totals assets, liabilities and the difference between them", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("资产负债表")).toBeInTheDocument();
    expect(screen.getByText(/截至 2026-11-15/)).toBeInTheDocument();

    const stats = statsStrip();
    expect(stats.getByText("总资产")).toBeInTheDocument();
    expect(stats.getByText("¥3,500.00")).toBeInTheDocument();
    expect(stats.getByText("总负债")).toBeInTheDocument();
    expect(stats.getByText("-¥120.00")).toBeInTheDocument();
    expect(stats.getByText("净资产")).toBeInTheDocument();
    expect(stats.getByText("¥3,380.00")).toBeInTheDocument();
    expect(stats.getByText("资产负债率")).toBeInTheDocument();
    expect(stats.getByText("3.4%")).toBeInTheDocument();
  });

  it("lists the asset accounts and the liability accounts apart", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("资产账户")).toBeInTheDocument();
    expect(screen.getByText("负债账户")).toBeInTheDocument();

    expect(screen.getByText("现金")).toBeInTheDocument();
    expect(screen.getByText("银行卡")).toBeInTheDocument();
    expect(screen.getByText("信用卡")).toBeInTheDocument();
    // The account type column is translated, not echoed.
    expect(screen.getAllByText("资产")).toHaveLength(2);
    expect(screen.getByText("负债")).toBeInTheDocument();

    // "资产合计" is both the footer's label and the headline strip's hint.
    expect(screen.getAllByText("资产合计")).toHaveLength(2);
    expect(screen.getAllByText("负债合计")).toHaveLength(2);
  });

  it("keeps an unknown account type readable", async () => {
    api.reportBalanceSheet.mockResolvedValue({
      ...SHEET,
      assets: [
        {
          accountId: "a9",
          accountName: "数字钱包",
          accountType: "crypto",
          balance: 1000,
        },
      ],
      liabilities: [],
      totalAssets: 1000,
      totalLiabilities: 0,
      netWorth: 1000,
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("crypto")).toBeInTheDocument();
  });

  it("shows a dash for the leverage when there are no assets", async () => {
    api.reportBalanceSheet.mockResolvedValue({
      snapshotDate: "2026-11-15",
      assets: [],
      liabilities: [
        {
          accountId: "l1",
          accountName: "信用卡",
          accountType: "liability",
          balance: -12000,
        },
      ],
      totalAssets: 0,
      totalLiabilities: -12000,
      netWorth: -12000,
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(statsStrip().getByText("—")).toBeInTheDocument();
    expect(screen.getByText("没有资产账户")).toBeInTheDocument();
    expect(screen.getAllByText("负债合计")).toHaveLength(2);
  });

  it("says so when the ledger holds no asset or liability account", async () => {
    api.reportBalanceSheet.mockResolvedValue({
      snapshotDate: "2026-11-15",
      assets: [],
      liabilities: [],
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("没有资产账户")).toBeInTheDocument();
    expect(screen.queryByText("账户余额分布")).toBeNull();
  });

  it("draws the balances on one axis", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    const chart = lastChart();
    expect(chart.option.yAxis?.data).toEqual(["信用卡", "银行卡", "现金"]);
    const values = (chart.option.series?.[0]?.data ?? []).map(
      (point) => (point as { value: number }).value,
    );
    expect(values).toEqual([-120, 3000, 500]);

    const formatter = chart.option.tooltip?.formatter;
    expect(formatter).toBeTypeOf("function");
    expect(formatter?.([])).toBe("");
    expect(formatter?.([{ name: "现金", marker: "●", value: 500 }])).toContain(
      "¥500.00",
    );
  });
});
