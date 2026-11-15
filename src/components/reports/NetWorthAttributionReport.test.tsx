import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { NetWorthAttributionReport } from "@/components/reports/NetWorthAttributionReport";
import { renderWithProviders } from "@/test-utils/render";
import {
  createReportController,
  type CapturedChart,
} from "@/test-utils/reportController";

const { api } = vi.hoisted(() => ({
  api: { reportStandard: vi.fn() },
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

const STANDARD = {
  periodIncome: 100000,
  periodExpense: 40000,
  prevIncome: 0,
  prevExpense: 0,
  incomeChangePct: 0,
  expenseChangePct: 0,
  netWorthTrend: [
    { date: "2026-11-01", netWorth: 300000 },
    { date: "2026-11-30", netWorth: 338000 },
  ],
  accountChanges: [
    {
      accountId: "a1",
      accountName: "现金",
      accountType: "asset",
      startBalance: 100000,
      endBalance: 150000,
      change: 50000,
    },
    {
      accountId: "l1",
      accountName: "信用卡",
      accountType: "liability",
      startBalance: -20000,
      endBalance: -12000,
      change: 8000,
    },
    {
      accountId: "a2",
      accountName: "沉睡账户",
      accountType: "asset",
      startBalance: 5000,
      endBalance: 5000,
      change: 0,
    },
  ],
};

function statsStrip() {
  const strip = document.querySelector('[data-elevation="raise"]');
  if (!strip) throw new Error("stats strip not rendered");
  return within(strip as HTMLElement);
}

/** The chart whose panel title matches. */
function chartByLabel(label: string): CapturedChart {
  const found = charts
    .filter((chart) => (chart as CapturedChart).label === label)
    .pop();
  if (!found) throw new Error(`no chart labelled ${label}`);
  return found as CapturedChart;
}

async function renderReport(
  controller: ReturnType<typeof createReportController>["controller"],
) {
  const result = renderWithProviders(
    <NetWorthAttributionReport controller={controller} />,
  );
  await waitFor(() => expect(screen.queryByText("加载中…")).toBeNull());
  return result;
}

describe("NetWorthAttributionReport", () => {
  beforeEach(() => {
    charts.length = 0;
    api.reportStandard.mockReset();
    api.reportStandard.mockResolvedValue(STANDARD);
  });

  it("opens with where the net worth started and ended", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("净资产归因")).toBeInTheDocument();

    const stats = statsStrip();
    expect(stats.getByText("期初净资产")).toBeInTheDocument();
    expect(stats.getByText("¥850.00")).toBeInTheDocument();
    expect(stats.getByText("期末净资产")).toBeInTheDocument();
    expect(stats.getByText("¥1,430.00")).toBeInTheDocument();
    expect(stats.getByText("期间变动")).toBeInTheDocument();
    expect(stats.getByText("¥580.00")).toBeInTheDocument();
    expect(stats.getByText("变动率")).toBeInTheDocument();
    expect(stats.getByText("68.2%")).toBeInTheDocument();
  });

  it("splits the change by account and shares it out", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("账户余额明细")).toBeInTheDocument();
    // header plus one row per account, the untouched one included
    expect(screen.getAllByRole("row")).toHaveLength(4);

    expect(screen.getByText("沉睡账户")).toBeInTheDocument();
    expect(screen.getByText("86.2%")).toBeInTheDocument();
    expect(screen.getByText("13.8%")).toBeInTheDocument();
  });

  it("shows a dash for the share when nothing moved", async () => {
    api.reportStandard.mockResolvedValue({
      ...STANDARD,
      netWorthTrend: [],
      accountChanges: [
        {
          accountId: "a2",
          accountName: "沉睡账户",
          accountType: "asset",
          startBalance: 5000,
          endBalance: 5000,
          change: 0,
        },
      ],
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(statsStrip().getByText("0.0%")).toBeInTheDocument();
    expect(screen.getByText("该区间没有记录")).toBeInTheDocument();
    expect(screen.getByText("该区间没有余额变动")).toBeInTheDocument();
    // the share column has nothing to divide by
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("draws the trend and the per-account ranking", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    const trend = chartByLabel("净资产走势");
    expect(trend.option.xAxis?.data).toEqual(["11-01", "11-30"]);
    const trendFormatter = trend.option.tooltip?.formatter;
    expect(trendFormatter?.([])).toBe("");
    expect(
      trendFormatter?.([{ axisValue: "11-01", marker: "●", value: 3000 }]),
    ).toContain("¥3,000.00");

    const ranking = chartByLabel("账户贡献");
    expect(ranking.option.yAxis?.data).toEqual(["信用卡", "现金"]);
    const rankingFormatter = ranking.option.tooltip?.formatter;
    expect(rankingFormatter?.([])).toBe("");
    expect(
      rankingFormatter?.([{ name: "现金", marker: "●", value: 500 }]),
    ).toContain("¥500.00");
  });

  it("colours an account that lost money as an expense", async () => {
    api.reportStandard.mockResolvedValue({
      ...STANDARD,
      accountChanges: [
        {
          accountId: "a1",
          accountName: "现金",
          accountType: "asset",
          startBalance: 100000,
          endBalance: 50000,
          change: -50000,
        },
      ],
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("现金")).toBeInTheDocument();
    expect(screen.getAllByText("-¥500.00").length).toBeGreaterThan(0);
  });

  it("names an account of a kind it has no word for", async () => {
    api.reportStandard.mockResolvedValue({
      ...STANDARD,
      accountChanges: [
        {
          accountId: "x1",
          accountName: "怪账户",
          accountType: "somethingElse",
          startBalance: 0,
          endBalance: 100,
          change: 100,
        },
      ],
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("怪账户")).toBeInTheDocument();
    expect(screen.getByText("somethingElse")).toBeInTheDocument();
  });

  it("says so when the net worth went down", async () => {
    api.reportStandard.mockResolvedValue({
      ...STANDARD,
      netWorthTrend: [
        { date: "2026-11-01", netWorth: 500000 },
        { date: "2026-11-30", netWorth: 300000 },
      ],
      accountChanges: [
        {
          accountId: "a1",
          accountName: "现金",
          accountType: "asset",
          startBalance: 500000,
          endBalance: 300000,
          change: -200000,
        },
      ],
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(statsStrip().getAllByText("-¥2,000.00").length).toBeGreaterThan(0);
    expect(statsStrip().getAllByText("-40.0%").length).toBeGreaterThan(0);
  });
});
