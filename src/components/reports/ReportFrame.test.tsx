import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import {
  Amount,
  ReportFrame,
  ReportPanel,
  ReportStats,
  ReportTable,
} from "@/components/reports/ReportFrame";
import { renderWithProviders } from "@/test-utils/render";

describe("ReportFrame", () => {
  it("shows the title and the scope of the report", () => {
    renderWithProviders(
      <ReportFrame
        title="现金流量"
        scope="统计口径：收入按分类记账的贷方发生额"
      />,
    );

    expect(screen.getByText("现金流量")).toBeInTheDocument();
    expect(
      screen.getByText("统计口径：收入按分类记账的贷方发生额"),
    ).toBeInTheDocument();
  });

  it("shows the report itself", () => {
    renderWithProviders(
      <ReportFrame title="现金流量">
        <p>报表内容</p>
      </ReportFrame>,
    );

    expect(screen.getByText("报表内容")).toBeInTheDocument();
  });

  it("shows the controls the report brought", () => {
    renderWithProviders(
      <ReportFrame title="现金流量" toolbar={<button>筛选</button>} />,
    );

    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
  });

  it("says so while the report is loading", () => {
    renderWithProviders(<ReportFrame title="现金流量" isLoading />);

    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("says so when the report failed", () => {
    renderWithProviders(
      <ReportFrame title="现金流量" error={new Error("读不出来")} />,
    );

    expect(screen.getByText("加载失败")).toBeInTheDocument();
    expect(screen.getByText("读不出来")).toBeInTheDocument();
  });

  it("says so when there is nothing to show", () => {
    renderWithProviders(<ReportFrame title="现金流量" isEmpty />);

    expect(screen.getByText("该区间没有记录")).toBeInTheDocument();
  });

  it("says why there is nothing to show", () => {
    renderWithProviders(
      <ReportFrame title="现金流量" isEmpty emptyHint="这个月还没有记账" />,
    );

    expect(screen.getByText("这个月还没有记账")).toBeInTheDocument();
  });
});

describe("ReportStats", () => {
  it("shows the figures the report opens with", () => {
    renderWithProviders(
      <ReportStats
        items={[
          { label: "收入", value: "¥100.00", tone: "income" },
          {
            label: "支出",
            value: "¥40.00",
            hint: "占收入 40%",
            tone: "expense",
          },
        ]}
      />,
    );

    expect(screen.getByText("收入")).toBeInTheDocument();
    expect(screen.getByText("¥100.00")).toBeInTheDocument();
    expect(screen.getByText("占收入 40%")).toBeInTheDocument();
  });
});

describe("ReportPanel", () => {
  it("shows a titled panel", () => {
    renderWithProviders(
      <ReportPanel title="收支趋势" hint="单位：元">
        <p>图</p>
      </ReportPanel>,
    );

    expect(screen.getByText("收支趋势")).toBeInTheDocument();
    expect(screen.getByText("单位：元")).toBeInTheDocument();
    expect(screen.getByText("图")).toBeInTheDocument();
  });

  it("shows a panel without a title", () => {
    renderWithProviders(
      <ReportPanel>
        <p>图</p>
      </ReportPanel>,
    );

    expect(screen.getByText("图")).toBeInTheDocument();
  });
});

describe("ReportTable", () => {
  it("shows the rows and the footer", () => {
    renderWithProviders(
      <ReportTable
        columns={[
          { header: "分类", cell: (row: { name: string }) => row.name },
          {
            header: "金额",
            align: "right",
            cell: (row: { amount: number }) => row.amount,
          },
        ]}
        rows={[{ name: "餐饮", amount: 50 }]}
        rowKey={(row) => row.name}
        footer={
          <tr>
            <td>合计</td>
          </tr>
        }
      />,
    );

    expect(screen.getByText("分类")).toBeInTheDocument();
    expect(screen.getByText("餐饮")).toBeInTheDocument();
    expect(screen.getByText("合计")).toBeInTheDocument();
  });
});

describe("Amount", () => {
  it("colours a positive figure as income", () => {
    renderWithProviders(<Amount value={5000} />);

    const span = screen.getByText("¥50.00");
    expect(span.className).toContain("text-income");
  });

  it("colours a negative figure as an expense", () => {
    renderWithProviders(<Amount value={-5000} />);

    const span = screen.getByText("-¥50.00");
    expect(span.className).toContain("text-expense");
  });

  it("keeps the tone it was given", () => {
    renderWithProviders(<Amount value={5000} tone="plain" />);

    const span = screen.getByText("¥50.00");
    expect(span.className).toContain("text-foreground");
  });
});
