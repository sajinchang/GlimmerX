import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MonthPicker } from "@/components/ui/month-picker";
import { renderWithProviders } from "@/test-utils/render";

describe("MonthPicker", () => {
  it("shows the month it holds", () => {
    renderWithProviders(<MonthPicker value="2026-11" onChange={vi.fn()} />);

    expect(screen.getByText("2026 11月")).toBeInTheDocument();
  });

  it("shows a placeholder when it holds nothing", () => {
    renderWithProviders(<MonthPicker onChange={vi.fn()} />);

    expect(screen.getByText("选择月份")).toBeInTheDocument();
  });

  it("picks a month out of the calendar", () => {
    const onChange = vi.fn();
    renderWithProviders(<MonthPicker value="2026-11" onChange={onChange} />);

    fireEvent.click(screen.getByText("2026 11月"));

    const day = Array.from(
      document.querySelectorAll<HTMLElement>('[role="gridcell"] button'),
    ).find((button) => button.textContent === "15");
    fireEvent.click(day as HTMLElement);

    expect(onChange).toHaveBeenCalledWith("2026-11");
  });

  it("keeps the year the reader picked", () => {
    const onChange = vi.fn();
    renderWithProviders(<MonthPicker value="2026-11" onChange={onChange} />);

    fireEvent.click(screen.getByText("2026 11月"));
    const day = Array.from(
      document.querySelectorAll<HTMLElement>('[role="gridcell"] button'),
    ).find((button) => button.textContent === "20");
    fireEvent.click(day as HTMLElement);

    expect(onChange).toHaveBeenCalledWith("2026-11");
  });

  it("cannot be pressed when it is disabled", () => {
    renderWithProviders(
      <MonthPicker value="2026-11" onChange={vi.fn()} disabled />,
    );

    expect(screen.getByText("2026 11月").closest("button")).toBeDisabled();
  });
});
