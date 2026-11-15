import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { ReportFilterBar } from "@/components/reports/ReportFilterBar";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { renderWithProviders } from "@/test-utils/render";
import { createReportController } from "@/test-utils/reportController";
import { clickOption, openSelect } from "@/test-utils/radix";
import type { ReportQueryController } from "@/hooks/useReportQuery";

function controllerWith(report: string, overrides = {}) {
  const { controller, spies } = createReportController(overrides);
  const patched = {
    ...controller,
    query: { ...controller.query, report },
    definition: {
      ...controller.definition,
      dateControl:
        report === "balanceSheet"
          ? ("snapshot" as const)
          : report === "budgets"
            ? ("month" as const)
            : ("range" as const),
    },
  } as unknown as ReportQueryController;
  return { controller: patched, spies };
}

describe("ReportFilterBar", () => {
  it("offers a period for a report that spans one", () => {
    const { controller } = controllerWith("cashflow");
    renderWithProviders(<ReportFilterBar controller={controller} />);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("picks another period", async () => {
    const { controller, spies } = controllerWith("cashflow");
    renderWithProviders(<ReportFilterBar controller={controller} />);

    const trigger = screen.getByRole("combobox");
    await openSelect(trigger);
    clickOption("上月");

    expect(spies.setPreset).toHaveBeenCalledWith("lastMonth");
  });

  it("offers the two ends of a custom range", () => {
    const { controller } = controllerWith("cashflow", {
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
    const patched = {
      ...controller,
      query: {
        ...controller.query,
        preset: "custom",
        start: "2026-11-01",
        end: "2026-11-30",
      },
    } as unknown as ReportQueryController;
    renderWithProviders(<ReportFilterBar controller={patched} />);

    expect(screen.getByText("2026年11月1日")).toBeInTheDocument();
    expect(screen.getByText("2026年11月30日")).toBeInTheDocument();
  });

  it("offers a single day for a snapshot", () => {
    const { controller } = controllerWith("balanceSheet");
    renderWithProviders(<ReportFilterBar controller={controller} />);

    expect(screen.getByText("快照日期")).toBeInTheDocument();
  });

  it("offers a month for the budgets", () => {
    const { controller } = controllerWith("budgets");
    renderWithProviders(<ReportFilterBar controller={controller} />);

    expect(screen.getByText("月份")).toBeInTheDocument();
  });

  it("goes back to the default period", () => {
    const { controller } = controllerWith("cashflow");
    const reset = vi.fn();
    renderWithProviders(
      <ReportFilterBar
        controller={
          { ...controller, reset } as unknown as ReportQueryController
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重置" }));

    expect(reset).toHaveBeenCalled();
  });
});

describe("popover", () => {
  it("opens and closes", () => {
    renderWithProviders(
      <Popover>
        <PopoverTrigger>打开</PopoverTrigger>
        <PopoverContent>内容</PopoverContent>
      </Popover>,
    );

    fireEvent.click(screen.getByText("打开"));

    expect(screen.getByText("内容")).toBeInTheDocument();
  });

  it("holds a header", () => {
    renderWithProviders(
      <Popover open>
        <PopoverAnchor>锚点</PopoverAnchor>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>标题</PopoverTitle>
            <PopoverDescription>说明</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>,
    );

    expect(screen.getByText("标题")).toBeInTheDocument();
    expect(screen.getByText("说明")).toBeInTheDocument();
  });
});
