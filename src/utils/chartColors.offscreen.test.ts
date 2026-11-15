import { describe, expect, it, vi } from "vitest";

/**
 * The browser can hand out an offscreen canvas, and then the probe does not
 * have to attach anything to the document.
 */
class FakeOffscreenCanvas {
  getContext() {
    return {
      fillStyle: "#000000",
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([10, 20, 30, 128]),
      })),
    };
  }
}

(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
  FakeOffscreenCanvas;

const { resolveColor } = await import("@/utils/chartColors");

describe("resolveColor with an offscreen canvas", () => {
  it("reads a colour that is not fully opaque", () => {
    expect(resolveColor("#ff0000", "#000000")).toBe("rgba(10, 20, 30, 0.502)");
  });
});
