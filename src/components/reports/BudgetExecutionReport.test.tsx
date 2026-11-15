import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { BudgetExecutionReport } from "@/components/reports/BudgetExecutionReport";
import { renderWithProviders } from "@/test-utils/render";
import {
  createReportController,
  type CapturedChart,
} from "@/test-utils/reportController";

const { api } = vi.hoisted(() => ({
  api: { budgetListStatuses: vi.fn() },
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

const STATUSES = [
  {
    id: "b1",
    categoryId: "c1",
    amount: 100000,
    period: "monthly",
    rollover: true,
    categoryName: "餐饮",
    categoryIcon: null,
    spent: 120000,
    remaining: -20000,
    overBudget: true,
    rolloverAmount: 5000,
    available: 5000,
  },
  {
    id: "b2",
    categoryId: "c2",
    amount: 50000,
    period: "monthly",
    rollover: false,
    categoryName: "交通",
    categoryIcon: null,
    spent: 10000,
    remaining: 40000,
    overBudget: false,
    rolloverAmount: 0,
    available: 50000,
  },
];

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
    <BudgetExecutionReport controller={controller} />,
  );
  await waitFor(() => expect(screen.queryByText("加载中…")).toBeNull());
  return result;
}

describe("BudgetExecutionReport", () => {
  beforeEach(() => {
    charts.length = 0;
    api.budgetListStatuses.mockReset();
    api.budgetListStatuses.mockResolvedValue(STATUSES);
  });

  it("adds the plan and the spend up across categories", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("预算执行")).toBeInTheDocument();
    expect(screen.getByText(/计算 2026-11 的实际执行/)).toBeInTheDocument();

    const stats = statsStrip();
    expect(stats.getByText("预算")).toBeInTheDocument();
    expect(stats.getByText("¥1,500.00")).toBeInTheDocument();
    expect(stats.getByText("共 2 个分类")).toBeInTheDocument();
    expect(stats.getByText("已支出")).toBeInTheDocument();
    expect(stats.getByText("¥1,300.00")).toBeInTheDocument();
    expect(stats.getByText("87%")).toBeInTheDocument();
    expect(stats.getByText("剩余")).toBeInTheDocument();
    expect(stats.getByText("¥200.00")).toBeInTheDocument();
    expect(stats.getByText("超支项")).toBeInTheDocument();
    expect(stats.getByText("1")).toBeInTheDocument();
  });

  it("puts the category that needs attention first", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("分类执行明细")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    // worst first: 餐饮 spends 120% of its plan, 交通 only 20%
    expect(rows[1]?.textContent).toContain("餐饮");
    expect(rows[2]?.textContent).toContain("交通");

    expect(screen.getByText("120%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("shows the rollover where there is one and a dash where there is not", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("结转")).toBeInTheDocument();
    expect(screen.getByText("¥50.00")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("says so when no budget has been set", async () => {
    api.budgetListStatuses.mockResolvedValue([]);
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("还没有设置预算")).toBeInTheDocument();
  });

  it("copes with a category that has no budget amount", async () => {
    api.budgetListStatuses.mockResolvedValue([
      {
        id: "b3",
        categoryId: "c1",
        amount: 0,
        period: "monthly",
        rollover: false,
        categoryName: "餐饮",
        categoryIcon: null,
        spent: 0,
        remaining: 0,
        overBudget: false,
        rolloverAmount: 0,
        available: 0,
      },
    ]);
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(statsStrip().getByText("—")).toBeInTheDocument();
  });

  it("draws the spend as a bar over the plan", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    const chart = lastChart();
    expect(chart.option.yAxis?.data).toEqual(["交通", "餐饮"]);
    const series = chart.option.series ?? [];
    expect(series).toHaveLength(2);
    expect(series[0]?.data).toEqual([500, 1000]);
    const spent = (series[1]?.data ?? []).map(
      (point) => (point as { value: number }).value,
    );
    expect(spent).toEqual([100, 1200]);

    const formatter = chart.option.tooltip?.formatter;
    expect(formatter).toBeTypeOf("function");
    expect(formatter?.([])).toBe("");
    expect(
      formatter?.([
        { name: "餐饮", marker: "●", seriesName: "已支出", value: 1200 },
      ]),
    ).toContain("¥1,200.00");
  });
});
