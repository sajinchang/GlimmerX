import { vi } from "vitest";
import type { ReportQueryController } from "@/hooks/useReportQuery";
import type { CompareMode, PeriodGranularity } from "@/types/report";

/**
 * A stand-in for the controller the reports page hands down.
 *
 * The real one is built from the URL by `useReportQuery`, so a report test
 * would otherwise have to mount the whole page to get a range and a compare
 * mode. Reports only read a handful of fields and call a handful of setters,
 * so a plain object with the same shape is enough — and it lets one test
 * drive a branch (compare on / off, an account picked or not) without touching
 * the router.
 */
export interface ReportControllerOverrides {
  compare?: CompareMode;
  granularity?: PeriodGranularity;
  granularityOptions?: PeriodGranularity[];
  anchor?: string;
  accountId?: string;
  startDate?: string;
  endDate?: string;
  /** The `YYYY-MM` the budget report shows in its scope line. */
  anchorMonthValue?: string;
}

export interface ReportControllerSpies {
  setCompare: ReturnType<typeof vi.fn>;
  setGranularity: ReturnType<typeof vi.fn>;
  setAccount: ReturnType<typeof vi.fn>;
  setPreset: ReturnType<typeof vi.fn>;
  setCustomRange: ReturnType<typeof vi.fn>;
  setAnchor: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
}

export interface ReportControllerHandle {
  controller: ReportQueryController;
  spies: ReportControllerSpies;
}

export function createReportController(
  overrides: ReportControllerOverrides = {},
): ReportControllerHandle {
  const startDate = overrides.startDate ?? "2026-11-01";
  const endDate = overrides.endDate ?? "2026-11-30";
  const compare = overrides.compare ?? "previousPeriod";
  const granularity = overrides.granularity ?? "monthly";
  const anchor = overrides.anchor ?? "2026-11-15";
  const accountId = overrides.accountId ?? "";
  const granularityOptions = overrides.granularityOptions ?? [
    "daily",
    "weekly",
    "monthly",
  ];

  const setCompare = vi.fn();
  const setGranularity = vi.fn();
  const setAccount = vi.fn();
  const setPreset = vi.fn();
  const setCustomRange = vi.fn();
  const setAnchor = vi.fn();
  const reset = vi.fn();

  const controller = {
    query: {
      report: "cashflow",
      preset: "currentMonth",
      start: "",
      end: "",
      granularity: null,
      compare,
      anchor,
      accountId,
    },
    range: { startDate, endDate },
    filter: {
      dateRangePreset: "currentMonth",
      startDate,
      endDate,
      periodGranularity: granularity,
      compare,
    },
    granularity,
    granularityOptions,
    anchorYear: Number(anchor.slice(0, 4)),
    anchorMonth: Number(anchor.slice(5, 7)),
    anchorMonthValue: overrides.anchorMonthValue ?? anchor.slice(0, 7),
    setCompare,
    setGranularity,
    setAccount,
    setPreset,
    setCustomRange,
    setAnchor,
    reset,
  } as unknown as ReportQueryController;

  return {
    controller,
    spies: {
      setCompare,
      setGranularity,
      setAccount,
      setPreset,
      setCustomRange,
      setAnchor,
      reset,
    },
  };
}

/**
 * The shape a report hands to the chart. Reports build their ECharts options
 * inline, and the tooltip/label callbacks inside those options are the parts
 * worth exercising: they are where the money is formatted for the reader.
 */
export interface CapturedChart {
  label: string;
  option: {
    tooltip?: { formatter?: (raw: unknown) => string };
    xAxis?: { data?: unknown[] };
    yAxis?: { data?: unknown[] };
    series?: {
      data?: unknown[];
      label?: { formatter?: (params: { value: number }) => string };
    }[];
  };
}
