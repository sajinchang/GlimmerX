import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { CashflowReport } from "@/components/reports/CashflowReport";
import { renderWithProviders } from "@/test-utils/render";
import {
  createReportController,
  type CapturedChart,
} from "@/test-utils/reportController";

const { api } = vi.hoisted(() => ({
  api: { reportStandard: vi.fn(), reportTrend: vi.fn() },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

/**
 * The chart is a canvas: nothing of the option is visible to the DOM. The stub
 * keeps the option so the tooltip callbacks — where the money is formatted for
 * the reader — can still be called.
 */
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

const POINT = {
  period: "2026-11",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  income: 100000,
  expense: 40000,
  net: 60000,
};

const STANDARD = {
  periodIncome: 100000,
  periodExpense: 40000,
  prevIncome: 80000,
  prevExpense: 50000,
  incomeChangePct: 25,
  expenseChangePct: -20,
  netWorthTrend: [],
  accountChanges: [],
};

const TREND = {
  granularity: "monthly",
  dataPoints: [POINT],
  totalIncome: 100000,
  totalExpense: 40000,
  totalNet: 60000,
};

/** The headline strip is the only `data-elevation="raise"` box on the page. */
function statsStrip() {
  const strip = document.querySelector('[data-elevation="raise"]');
  if (!strip) throw new Error("stats strip not rendered");
  return within(strip as HTMLElement);
}

/** The last option the chart stub was handed. */
function lastChart(): CapturedChart {
  const chart = charts[charts.length - 1];
  if (!chart) throw new Error("no chart rendered");
  return chart as CapturedChart;
}

async function renderReport(
  controller: ReturnType<typeof createReportController>["controller"],
) {
  const result = renderWithProviders(
    <CashflowReport controller={controller} />,
  );
  await waitFor(() => expect(screen.queryByText("加载中…")).toBeNull());
  return result;
}

describe("CashflowReport", () => {
  beforeEach(() => {
    charts.length = 0;
    api.reportStandard.mockReset();
    api.reportTrend.mockReset();
    api.reportStandard.mockResolvedValue(STANDARD);
    api.reportTrend.mockResolvedValue(TREND);
  });

  it("shows the four headline figures of the period", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("现金流")).toBeInTheDocument();
    expect(
      screen.getByText(/范围 2026-11-01 ~ 2026-11-30/),
    ).toBeInTheDocument();

    const stats = statsStrip();
    expect(stats.getByText("期间收入")).toBeInTheDocument();
    expect(stats.getByText("¥1,000.00")).toBeInTheDocument();
    expect(stats.getByText("期间支出")).toBeInTheDocument();
    expect(stats.getByText("¥400.00")).toBeInTheDocument();
    expect(stats.getByText("结余")).toBeInTheDocument();
    expect(stats.getByText("¥600.00")).toBeInTheDocument();
    expect(stats.getByText("储蓄率")).toBeInTheDocument();
    expect(stats.getByText("60.0%")).toBeInTheDocument();
  });

  it("hints what the totals are compared against", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    const stats = statsStrip();
    expect(stats.getByText("较上期 +25.0%")).toBeInTheDocument();
    expect(stats.getByText("较上期 -20.0%")).toBeInTheDocument();
    expect(stats.getByText("较上期 +¥300.00")).toBeInTheDocument();
  });

  it("compares the period against the previous one when asked to", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("本期与上期")).toBeInTheDocument();
    expect(screen.getByText("指标")).toBeInTheDocument();
    expect(screen.getByText("上期")).toBeInTheDocument();
    expect(screen.getByText("差额")).toBeInTheDocument();

    expect(screen.getByText("+25.0%")).toBeInTheDocument();
    expect(screen.getByText("−20.0%")).toBeInTheDocument();
    expect(screen.getAllByText("+100.0%").length).toBeGreaterThan(0);
  });

  it("hides the comparison when there is nothing to compare against", async () => {
    const { controller } = createReportController({ compare: "none" });
    await renderReport(controller);

    expect(screen.queryByText("本期与上期")).toBeNull();
    expect(screen.queryByText("指标")).toBeNull();
    expect(statsStrip().queryByText(/较上期/)).toBeNull();
  });

  it("labels the previous column by the year when comparing to last year", async () => {
    const { controller } = createReportController({ compare: "lastYear" });
    await renderReport(controller);

    expect(screen.getByText("本期与去年同期")).toBeInTheDocument();
    expect(screen.getByText("去年同期")).toBeInTheDocument();
    expect(statsStrip().getByText("较去年同期 +25.0%")).toBeInTheDocument();
  });

  it("shows a dash where a percentage cannot be computed", async () => {
    api.reportStandard.mockResolvedValue({
      ...STANDARD,
      periodIncome: 0,
      periodExpense: 0,
      prevIncome: 0,
      prevExpense: 0,
    });
    const { controller } = createReportController();
    await renderReport(controller);

    // 储蓄率 and the three change rates all fall back to a dash.
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("cuts the time axis by the granularity the trend came back in", async () => {
    const cases: [string, string, string][] = [
      ["daily", "2026-11-05", "11-05"],
      ["weekly", "2026-W45", "26 W45"],
      ["monthly", "2026-11", "26 11月"],
      ["yearly", "2026", "2026"],
    ];

    for (const [granularity, period, expected] of cases) {
      api.reportTrend.mockResolvedValue({
        ...TREND,
        granularity,
        dataPoints: [{ ...POINT, period }],
      });
      const { controller } = createReportController();
      const { unmount } = await renderReport(controller);

      expect(lastChart().option.xAxis?.data).toEqual([expected]);
      unmount();
    }
  });

  it("formats the tooltip the way the table shows the money", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    const formatter = lastChart().option.tooltip?.formatter;

    expect(formatter).toBeTypeOf("function");
    expect(formatter?.([])).toBe("");
    expect(
      formatter?.([
        { marker: "●", seriesName: "收入", value: 12.5, axisValue: "26 11月" },
      ]),
    ).toContain("¥12.50");
    expect(lastChart().option.series?.[0]?.data).toEqual([1000]);
  });

  it("calls a change from nothing a full hundred per cent", async () => {
    api.reportStandard.mockResolvedValue({
      ...STANDARD,
      prevIncome: 0,
      prevExpense: 0,
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getAllByText("+100.0%").length).toBeGreaterThan(0);
  });

  it("shows a period that went under water", async () => {
    api.reportStandard.mockResolvedValue({
      ...STANDARD,
      periodIncome: 10000,
      periodExpense: 40000,
      prevIncome: 10000,
      prevExpense: 40000,
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getAllByText("结余").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-¥300.00").length).toBeGreaterThan(0);
  });

  it("falls back to a month on the axis when the trend says nothing", async () => {
    api.reportTrend.mockResolvedValue({ ...TREND, granularity: undefined });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(lastChart().option.xAxis?.data).toEqual(["26 11月"]);
  });

  it("leaves the label out when the tooltip has none", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    const formatter = lastChart().option.tooltip?.formatter;
    expect(
      formatter?.([{ marker: "●", seriesName: "收入", value: 12.5 }]),
    ).toContain("<br/>");
  });
});
