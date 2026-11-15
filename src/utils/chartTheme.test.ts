import { describe, expect, it, vi, afterEach } from "vitest";
import {
  categoryAxis,
  chartAnimation,
  chartGrid,
  chartLegend,
  chartTextStyle,
  chartTooltip,
  lineSeriesDefaults,
  prefersReducedMotion,
  valueAxis,
  yuanTick,
} from "./chartTheme";
import type { ChartColors } from "./chartColors";

afterEach(() => {
  vi.unstubAllGlobals();
});

const colors: ChartColors = {
  income: "#3f9c6d",
  expense: "#c0463f",
  signal: "#ffa02f",
  info: "#3f7f9c",
  text: "#e6edf3",
  neutral: "#7e8b9c",
  surface: "#1b2129",
  border: "#2a323d",
  grid: "#39414d",
  axis: "#7e8b9c",
  series: ["#7ba7c9", "#c9a06a", "#8bbf9f", "#b98fb5"],
  mono: "ui-monospace, monospace",
  sans: "system-ui, sans-serif",
};

describe("lineSeriesDefaults", () => {
  it("does not dim the other series on hover", () => {
    // ECharts' own default is `focus: "series"`, which pushes every other
    // series to 10% opacity. On a two-line chart that reads as the line having
    // been deleted, and every pointer move flips which series is dimmed —
    // measured as a 7% swing in drawn pixels while the cursor barely moves.
    expect(lineSeriesDefaults(colors).emphasis.focus).toBe("none");
  });
});

describe("chartTooltip", () => {
  it("keeps the box inside the canvas", () => {
    // Without confinement the box is placed against the cursor and overflows
    // the plot, where the card's rounded clip cuts it in half.
    expect(chartTooltip(colors).confine).toBe(true);
  });

  it("snaps instead of chasing the cursor", () => {
    // The default is a 0.4 s transform transition; each pointer move restarts
    // it towards a position that has already changed, so the box oscillates.
    expect(chartTooltip(colors).transitionDuration).toBe(0);
  });

  it("uses the theme surface and lets callers override the trigger", () => {
    const tooltip = chartTooltip(colors, {
      trigger: "item",
      formatter: () => "42",
    });
    expect(tooltip.trigger).toBe("item");
    expect(tooltip.backgroundColor).toBe(colors.surface);
    expect(tooltip.textStyle.color).toBe(colors.text);
    expect(tooltip.formatter?.(undefined)).toBe("42");
    expect(chartTooltip(colors).trigger).toBe("axis");
  });
});

describe("chartGrid", () => {
  it("defaults to the shared inset and accepts overrides", () => {
    expect(chartGrid()).toMatchObject({
      left: 4,
      right: 12,
      top: 30,
      bottom: 4,
    });
    expect(chartGrid({ left: 24, bottom: 20 })).toMatchObject({
      left: 24,
      bottom: 20,
      top: 30,
    });
    expect(chartGrid().containLabel).toBe(true);
  });
});

describe("chartLegend", () => {
  it("keeps Chinese in the UI face at legend size", () => {
    const legend = chartLegend(colors);
    expect(legend.textStyle.fontFamily).toBe(colors.sans);
    expect(legend.textStyle.fontSize).toBe(11);
    expect(legend.icon).toBe("roundRect");
  });
});

describe("axes", () => {
  it("category axis hides ticks and mutes the baseline", () => {
    const axis = categoryAxis(colors);
    expect(axis.type).toBe("category");
    expect(axis.axisTick.show).toBe(false);
    expect(axis.axisLine.lineStyle.color).toBe(colors.grid);
    expect(axis.axisLabel.fontFamily).toBe(colors.mono);
  });

  it("value axis keeps only dashed horizontal gridlines", () => {
    const formatter = (value: number) => `${value}`;
    const axis = valueAxis(colors, formatter);
    expect(axis.type).toBe("value");
    expect(axis.axisLine.show).toBe(false);
    expect(axis.splitLine.lineStyle.type).toEqual([2, 4]);
    expect(axis.axisLabel.formatter).toBe(formatter);
  });
});

describe("chartTextStyle", () => {
  it("roots everything in the UI face", () => {
    expect(chartTextStyle(colors)).toEqual({
      fontFamily: colors.sans,
      color: colors.text,
    });
  });
});

describe("chartAnimation", () => {
  it("animates when motion is allowed", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(prefersReducedMotion()).toBe(false);
    expect(chartAnimation()).toMatchObject({
      animation: true,
      animationDuration: 180,
    });
  });

  it("turns animation off for reduced-motion users", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    expect(prefersReducedMotion()).toBe(true);
    expect(chartAnimation().animation).toBe(false);
  });
});

describe("yuanTick", () => {
  it("groups thousands without abbreviating", () => {
    // `12.3k` above `9,000` would put two units on one axis.
    const tick = yuanTick("en-US");
    expect(tick(9000)).toBe("9,000");
    expect(tick(1200)).toBe("1,200");
  });
});
