import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { resolveColor, useChartColors } from "@/utils/chartColors";

describe("resolveColor", () => {
  it("keeps the fallback when there is nothing to resolve", () => {
    expect(resolveColor("", "#123456")).toBe("#123456");
  });

  it("keeps the fallback when the browser cannot paint the value", () => {
    // jsdom has no canvas, so the probe has no context and every value falls
    // back to the token's fallback.
    expect(resolveColor("oklch(0.7 0.1 20)", "#123456")).toBe("#123456");
  });
});

describe("useChartColors", () => {
  it("hands the palette to the chart", () => {
    const { result } = renderHook(() => useChartColors());

    expect(result.current.income).toBe("#3f9c6d");
    expect(result.current.expense).toBe("#c0463f");
    expect(result.current.series).toHaveLength(8);
    expect(result.current.mono).toContain("monospace");
    expect(result.current.sans).toContain("sans-serif");
  });
});
