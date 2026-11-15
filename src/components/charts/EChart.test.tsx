import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { EChart } from "@/components/charts/EChart";

const { chart, observers } = vi.hoisted(() => ({
  chart: {
    init: vi.fn(),
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  },
  observers: [] as Array<() => void>,
}));

/** A ResizeObserver that only fires when the test says so. */
class FakeResizeObserver {
  constructor(callback: () => void) {
    observers.push(callback);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.mock("@/components/charts/echarts", () => ({
  echarts: { init: chart.init },
}));

describe("EChart", () => {
  beforeEach(() => {
    observers.length = 0;
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
    chart.init.mockReset();
    chart.setOption.mockReset();
    chart.resize.mockReset();
    chart.dispose.mockReset();
    chart.init.mockReturnValue({
      setOption: chart.setOption,
      resize: chart.resize,
      dispose: chart.dispose,
    });
  });

  it("describes itself to a screen reader", () => {
    render(<EChart option={{}} label="净资产走势" />);

    expect(screen.getByRole("img", { name: "净资产走势" })).toBeInTheDocument();
  });

  it("does not paint a chart that has no size", () => {
    render(<EChart option={{}} label="图表" />);

    // jsdom has no layout, so the host is 0×0 and there is nothing to paint.
    expect(chart.init).not.toHaveBeenCalled();
  });

  it("paints as soon as the chart has a size", () => {
    const { container } = render(<EChart option={{}} label="图表" />);
    const host = container.firstElementChild as HTMLElement;
    Object.defineProperty(host, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(host, "clientHeight", {
      value: 200,
      configurable: true,
    });

    act(() => {
      for (const callback of observers) callback();
    });

    expect(chart.init).toHaveBeenCalled();
    expect(chart.setOption).toHaveBeenCalled();
  });

  it("skips a resize that changes nothing", () => {
    const { container } = render(<EChart option={{}} label="图表" />);
    const host = container.firstElementChild as HTMLElement;
    Object.defineProperty(host, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(host, "clientHeight", {
      value: 200,
      configurable: true,
    });

    act(() => {
      for (const callback of observers) callback();
    });
    chart.resize.mockClear();

    act(() => {
      for (const callback of observers) callback();
    });

    expect(chart.resize).not.toHaveBeenCalled();
  });

  it("repaints for the print layout", () => {
    const { container } = render(<EChart option={{}} label="图表" />);
    const host = container.firstElementChild as HTMLElement;
    Object.defineProperty(host, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(host, "clientHeight", {
      value: 200,
      configurable: true,
    });

    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });

    expect(chart.init).toHaveBeenCalled();
  });

  it("falls back to the window when the browser has no observer", () => {
    const original = globalThis.ResizeObserver;
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

    try {
      const { container } = render(<EChart option={{}} label="图表" />);
      const host = container.firstElementChild as HTMLElement;
      Object.defineProperty(host, "clientWidth", { value: 400 });
      Object.defineProperty(host, "clientHeight", { value: 200 });

      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      expect(chart.init).toHaveBeenCalled();
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("lets go of the chart when it goes away", () => {
    const { container, unmount } = render(<EChart option={{}} label="图表" />);
    const host = container.firstElementChild as HTMLElement;
    Object.defineProperty(host, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(host, "clientHeight", {
      value: 200,
      configurable: true,
    });

    act(() => {
      for (const callback of observers) callback();
    });
    unmount();

    expect(chart.dispose).toHaveBeenCalled();
  });

  it("resizes the chart when its box changes", () => {
    const { container } = render(<EChart option={{}} label="图表" />);
    const host = container.firstElementChild as HTMLElement;
    Object.defineProperty(host, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(host, "clientHeight", {
      value: 200,
      configurable: true,
    });

    act(() => {
      for (const callback of observers) callback();
    });
    expect(chart.init).toHaveBeenCalled();

    Object.defineProperty(host, "clientWidth", {
      value: 800,
      configurable: true,
    });
    act(() => {
      for (const callback of observers) callback();
    });

    expect(chart.resize).toHaveBeenCalled();
  });
});
