import { beforeEach, describe, expect, it, vi } from "vitest";

const { language } = vi.hoisted(() => ({ language: { current: "zh" } }));

vi.mock("@/i18n", () => ({
  getCurrentLanguage: () => language.current,
}));

import {
  currentMonthBoundsLocal,
  formatDate,
  formatDateLong,
  formatDateShort,
  formatDateTime,
  formatDateTimeShort,
  formatLocalDate,
  formatMonthYear,
  formatRelative,
  formatTime,
  getDefaultRangePresetDates,
  parseDateSafe,
  todayLocalDate,
} from "@/utils/date";

describe("parseDateSafe", () => {
  it("reads a business date as local midnight", () => {
    const date = parseDateSafe("2026-10-26");

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(9);
    expect(date.getDate()).toBe(26);
    expect(date.getHours()).toBe(0);
  });

  it("reads a year on its own", () => {
    const date = parseDateSafe("2026");

    // The month and the day are missing, so they fall back to zero and the
    // date lands on the last day of the year before.
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(10);
    expect(date.getDate()).toBe(30);
  });

  it("keeps only the date part of a timestamp", () => {
    const date = parseDateSafe("2026-10-26T13:45:00+08:00");

    expect(date.getDate()).toBe(26);
    expect(date.getHours()).toBe(0);
  });
});

describe("formatLocalDate", () => {
  it("writes the date back the way it came in", () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("todayLocalDate", () => {
  it("names today", () => {
    const today = new Date();
    expect(todayLocalDate()).toBe(formatLocalDate(today));
  });
});

describe("currentMonthBoundsLocal", () => {
  it("spans the month around today", () => {
    const now = new Date();
    const bounds = currentMonthBoundsLocal();

    expect(bounds.start).toBe(
      formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    );
    expect(bounds.end).toBe(
      formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    );
  });
});

describe("the date formatters", () => {
  beforeEach(() => {
    language.current = "zh";
  });

  it("writes a short date in Chinese", () => {
    expect(formatDateShort("2026-10-26")).toBe("10月26日");
  });

  it("writes a long date in Chinese", () => {
    expect(formatDateLong("2026-10-26")).toBe("2026年10月26日");
  });

  it("writes a date in Chinese", () => {
    expect(formatDate("2026-10-26")).toBe("2026年10月26日");
  });

  it("writes a time", () => {
    expect(formatTime("2026-10-26T13:45:00+08:00")).toBe("13:45");
  });

  it("writes a short date with a time in Chinese", () => {
    expect(formatDateTimeShort("2026-10-26T13:45:00+08:00")).toBe(
      "10月26日 13:45",
    );
  });

  it("writes a date with a time in Chinese", () => {
    expect(formatDateTime("2026-10-26T13:45:07+08:00")).toBe(
      "2026年10月26日 13:45:07",
    );
  });

  it("writes a month and a year in Chinese", () => {
    expect(formatMonthYear("2026-10-26")).toBe("2026年10月");
  });

  it("writes a short date in English", () => {
    language.current = "en";
    expect(formatDateShort("2026-10-26")).toBe("Oct 26");
  });

  it("writes a long date in English", () => {
    language.current = "en";
    expect(formatDateLong("2026-10-26")).toBe("October 26, 2026");
  });

  it("writes a date in English", () => {
    language.current = "en";
    expect(formatDate("2026-10-26")).toBe("Oct 26, 2026");
  });

  it("writes a short date with a time in English", () => {
    language.current = "en";
    expect(formatDateTimeShort("2026-10-26T13:45:00+08:00")).toBe(
      "Oct 26, 13:45",
    );
  });

  it("writes a date with a time in English", () => {
    language.current = "en";
    expect(formatDateTime("2026-10-26T13:45:07+08:00")).toBe(
      "2026-10-26 13:45:07",
    );
  });

  it("writes a month and a year in English", () => {
    language.current = "en";
    expect(formatMonthYear("2026-10-26")).toBe("October 2026");
  });

  it("says how long ago something happened", () => {
    expect(formatRelative(new Date().toISOString())).toContain("前");

    language.current = "en";
    expect(formatRelative(new Date().toISOString())).toContain("ago");
  });
});

describe("getDefaultRangePresetDates", () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = formatLocalDate(now);

  it("spans the current month", () => {
    const range = getDefaultRangePresetDates("currentMonth");

    expect(range.startDate).toBe(formatLocalDate(new Date(year, month, 1)));
    expect(range.endDate).toBe(formatLocalDate(new Date(year, month + 1, 0)));
  });

  it("spans the month before", () => {
    const range = getDefaultRangePresetDates("lastMonth");

    expect(range.startDate).toBe(formatLocalDate(new Date(year, month - 1, 1)));
    expect(range.endDate).toBe(formatLocalDate(new Date(year, month, 0)));
  });

  it("spans the current year", () => {
    const range = getDefaultRangePresetDates("currentYear");

    expect(range.startDate).toBe(`${year}-01-01`);
    expect(range.endDate).toBe(today);
  });

  it("spans the year before", () => {
    const range = getDefaultRangePresetDates("lastYear");

    expect(range.startDate).toBe(`${year - 1}-01-01`);
    expect(range.endDate).toBe(`${year - 1}-12-31`);
  });

  it("spans the last three months", () => {
    const range = getDefaultRangePresetDates("last3Months");

    expect(range.startDate).toBe(formatLocalDate(new Date(year, month - 2, 1)));
    expect(range.endDate).toBe(today);
  });

  it("spans the last six months", () => {
    const range = getDefaultRangePresetDates("last6Months");

    expect(range.startDate).toBe(formatLocalDate(new Date(year, month - 5, 1)));
    expect(range.endDate).toBe(today);
  });

  it("spans the last twelve months", () => {
    const range = getDefaultRangePresetDates("last12Months");

    expect(range.startDate).toBe(formatLocalDate(new Date(year - 1, month, 1)));
    expect(range.endDate).toBe(today);
  });

  it("falls back to the current month", () => {
    const range = getDefaultRangePresetDates("custom");

    expect(range.startDate).toBe(formatLocalDate(new Date(year, month, 1)));
    expect(range.endDate).toBe(formatLocalDate(new Date(year, month + 1, 0)));
  });
});
