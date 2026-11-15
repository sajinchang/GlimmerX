import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useReportQuery } from "@/hooks/useReportQuery";
import { todayLocalDate } from "@/utils/date";

function renderReportQuery(url: string) {
  return renderHook(() => useReportQuery(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    ),
  });
}

describe("useReportQuery", () => {
  it("reads the report out of the address", () => {
    const { result } = renderReportQuery("/reports?r=balanceSheet");

    expect(result.current.query.report).toBe("balanceSheet");
    expect(result.current.definition).toBeTruthy();
  });

  it("falls back to the default report", () => {
    const { result } = renderReportQuery("/reports");

    expect(result.current.query.report).toBeTruthy();
  });

  it("swaps a reversed custom range", () => {
    const { result } = renderReportQuery(
      "/reports?r=cashflow&p=custom&s=2026-11-30&e=2026-11-01",
    );

    expect(result.current.range.startDate).toBe("2026-11-01");
    expect(result.current.range.endDate).toBe("2026-11-30");
  });

  it("keeps a range that is the right way round", () => {
    const { result } = renderReportQuery(
      "/reports?r=cashflow&p=custom&s=2026-11-01&e=2026-11-30",
    );

    expect(result.current.range.startDate).toBe("2026-11-01");
    expect(result.current.range.endDate).toBe("2026-11-30");
  });

  it("takes the current month when the custom range is empty", () => {
    const { result } = renderReportQuery("/reports?r=cashflow&p=custom");

    expect(result.current.range.startDate).not.toBe("");
  });

  it("anchors a month report on the month", () => {
    const { result } = renderReportQuery("/reports?r=budgets&d=2026-07-15");

    expect(result.current.query.anchor).toBe("2026-07");
  });

  it("anchors a day report on the day", () => {
    const { result } = renderReportQuery("/reports?r=cashflow&d=2026-07-15");

    expect(result.current.query.anchor).toBe("2026-07-15");
  });

  it("keeps the day of a snapshot report", () => {
    const { result } = renderReportQuery(
      "/reports?r=balanceSheet&d=2026-07-15",
    );

    expect(result.current.query.anchor).toBe("2026-07-15");
  });

  it("anchors a snapshot report on the first of the month", () => {
    const { result } = renderReportQuery("/reports?r=balanceSheet&d=2026-07");

    expect(result.current.query.anchor).toBe("2026-07-01");
  });

  it("anchors on today when nothing was picked", () => {
    const { result } = renderReportQuery("/reports?r=cashflow");

    expect(result.current.query.anchor).toBe(todayLocalDate());
  });

  it("writes the range into the address", () => {
    const { result } = renderReportQuery("/reports?r=cashflow");

    act(() => {
      result.current.setPreset("custom");
    });
    act(() => {
      result.current.setCustomRange("2026-11-01", "2026-11-30");
    });

    expect(result.current.query.preset).toBe("custom");
    expect(result.current.query.start).toBe("2026-11-01");
    expect(result.current.query.end).toBe("2026-11-30");
  });

  it("takes the range out of the address again", () => {
    const { result } = renderReportQuery(
      "/reports?r=cashflow&p=custom&s=2026-11-01&e=2026-11-30",
    );

    act(() => {
      result.current.setPreset("currentMonth");
    });

    expect(result.current.query.start).toBe("");
    expect(result.current.query.end).toBe("");
  });

  it("keeps a tick size that was picked", () => {
    const { result } = renderReportQuery("/reports?r=cashflow");

    act(() => {
      result.current.setGranularity("monthly");
    });

    expect(result.current.query.granularity).toBe("monthly");
  });

  it("writes the anchor that was picked", () => {
    const { result } = renderReportQuery("/reports?r=cashflow");

    act(() => {
      result.current.setAnchor("2026-07-15");
    });

    expect(result.current.query.anchor).toBe("2026-07-15");
  });

  it("writes the account that was picked", () => {
    const { result } = renderReportQuery("/reports?r=accounts");

    act(() => {
      result.current.setAccount("acc1");
    });

    expect(result.current.query.accountId).toBe("acc1");
  });

  it("takes the tick size away when everything is reset", () => {
    const { result } = renderReportQuery("/reports?r=cashflow&g=monthly");

    act(() => {
      result.current.reset();
    });

    expect(result.current.query.granularity).toBeNull();
  });

  it("picks another report", () => {
    const { result } = renderReportQuery("/reports?r=cashflow");

    act(() => {
      result.current.selectReport("categories");
    });

    expect(result.current.query.report).toBe("categories");
  });

  it("picks what to compare with", () => {
    const { result } = renderReportQuery("/reports?r=cashflow");

    act(() => {
      result.current.setCompare("lastYear");
    });

    expect(result.current.query.compare).toBe("lastYear");
  });

  it("reads the year and the month of the anchor", () => {
    const { result } = renderReportQuery("/reports?r=budgets&d=2026-07-15");

    expect(result.current.anchorYear).toBe(2026);
    expect(result.current.anchorMonth).toBe(7);
  });

  it("falls back to the current year and month", () => {
    const { result } = renderReportQuery("/reports?r=budgets");

    expect(result.current.anchorYear).toBeGreaterThan(2000);
    expect(result.current.anchorMonth).toBeGreaterThan(0);
  });
});
