import { describe, expect, it, vi } from "vitest";
import { resolveColor } from "@/utils/chartColors";

/**
 * jsdom has no canvas, so the probe has no context and every colour falls back.
 * The stub below gives it one: it is how the browser turns a modern colour
 * space into the sRGB triple ECharts can read.
 */
let fillStyle = "#000000";
const context = {
  get fillStyle() {
    return fillStyle;
  },
  set fillStyle(value: string) {
    // A value the browser does not understand leaves the old paint in place.
    if (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/i.test(value)) {
      fillStyle = value;
    }
  },
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  getImageData: vi.fn(() => ({
    data: new Uint8ClampedArray([1, 2, 3, 255]),
  })),
};

HTMLCanvasElement.prototype.getContext = vi.fn(
  () => context,
) as unknown as typeof HTMLCanvasElement.prototype.getContext;

describe("resolveColor with a canvas", () => {
  it("reads the colour back", () => {
    expect(resolveColor("#ff0000", "#000000")).toBe("rgb(1, 2, 3)");
  });

  it("keeps the fallback when the browser refuses the colour", () => {
    expect(resolveColor("not-a-colour", "#000000")).toBe("#000000");
  });

  it("keeps the fallback when there is nothing to read", () => {
    expect(resolveColor("", "#000000")).toBe("#000000");
  });
});
