import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CategoryBreakdownReport } from "@/components/reports/CategoryBreakdownReport";
import { renderWithProviders } from "@/test-utils/render";
import {
  createReportController,
  type CapturedChart,
} from "@/test-utils/reportController";

const { api } = vi.hoisted(() => ({
  api: { reportCategoryBreakdown: vi.fn() },
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

const EXPENSE = {
  totalAmount: 30000,
  categories: [
    {
      categoryId: "c1",
      categoryName: "餐饮",
      amount: 20000,
      percentage: 66.7,
      transactionCount: 3,
    },
    {
      categoryId: "c2",
      categoryName: "交通",
      amount: 10000,
      percentage: 33.3,
      transactionCount: 1,
    },
  ],
};

const INCOME = {
  totalAmount: 100000,
  categories: [
    {
      categoryId: "c9",
      categoryName: "工资",
      amount: 100000,
      percentage: 100,
      transactionCount: 1,
    },
  ],
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
    <CategoryBreakdownReport controller={controller} />,
  );
  await waitFor(() => expect(screen.queryByText("加载中…")).toBeNull());
  return result;
}

describe("CategoryBreakdownReport", () => {
  beforeEach(() => {
    charts.length = 0;
    api.reportCategoryBreakdown.mockReset();
    api.reportCategoryBreakdown.mockResolvedValue(EXPENSE);
  });

  it("summarises the period by category", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("分类构成")).toBeInTheDocument();

    const stats = statsStrip();
    expect(stats.getByText("支出总额")).toBeInTheDocument();
    expect(stats.getByText("¥300.00")).toBeInTheDocument();
    expect(stats.getByText("分类数")).toBeInTheDocument();
    expect(stats.getByText("2")).toBeInTheDocument();
    expect(stats.getByText("最大一项")).toBeInTheDocument();
    expect(stats.getByText("66.7%")).toBeInTheDocument();
    expect(stats.getByText("餐饮")).toBeInTheDocument();
    expect(stats.getByText("平均占比")).toBeInTheDocument();
    expect(stats.getByText("50.0%")).toBeInTheDocument();
  });

  it("lists every category with its amount, share and count", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("分类明细")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // one header row plus one row per category
    expect(rows).toHaveLength(3);
    expect(screen.getByText("交通")).toBeInTheDocument();
    expect(screen.getByText("¥200.00")).toBeInTheDocument();
    expect(screen.getByText("¥100.00")).toBeInTheDocument();
    expect(screen.getByText("33.3%")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("switches to income on request", async () => {
    api.reportCategoryBreakdown.mockImplementation(
      (_filter: unknown, kind: string) =>
        Promise.resolve(kind === "income" ? INCOME : EXPENSE),
    );
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("支出总额")).toBeInTheDocument();
    fireEvent.click(screen.getByText("收入"));

    await waitFor(() =>
      expect(screen.getByText("收入总额")).toBeInTheDocument(),
    );
    expect(api.reportCategoryBreakdown).toHaveBeenLastCalledWith(
      expect.anything(),
      "income",
    );
    expect(statsStrip().getByText("¥1,000.00")).toBeInTheDocument();
  });

  it("says so when the period has nothing to categorise", async () => {
    api.reportCategoryBreakdown.mockResolvedValue({
      totalAmount: 0,
      categories: [],
    });
    const { controller } = createReportController();
    await renderReport(controller);

    expect(screen.getByText("该区间没有可归类的记录")).toBeInTheDocument();
  });

  it("draws a ring of the category shares", async () => {
    const { controller } = createReportController();
    await renderReport(controller);

    expect(lastChart().option.series?.[0]?.data).toEqual([
      { name: "餐饮", value: 200 },
      { name: "交通", value: 100 },
    ]);

    const formatter = lastChart().option.tooltip?.formatter;
    expect(formatter).toBeTypeOf("function");
    expect(
      formatter?.({ marker: "●", name: "餐饮", value: 200, percent: 66.7 }),
    ).toContain("¥200.00");
  });
});
