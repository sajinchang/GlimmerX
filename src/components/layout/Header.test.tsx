import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { Header } from "@/components/layout/Header";
import { renderWithProviders } from "@/test-utils/render";

describe("Header", () => {
  it("names the page it is on", () => {
    renderWithProviders(<Header />, { route: "/transactions" });

    expect(screen.getByText("交易")).toBeInTheDocument();
  });

  it("falls back to the app name on a page it does not know", () => {
    renderWithProviders(<Header />, { route: "/nowhere" });

    expect(screen.getByText("GlimmerX")).toBeInTheDocument();
  });

  it("opens the quick add dialog", () => {
    const onQuickAdd = vi.fn();
    renderWithProviders(<Header onQuickAdd={onQuickAdd} />);

    fireEvent.click(screen.getByRole("button", { name: "快速记账" }));

    expect(onQuickAdd).toHaveBeenCalled();
  });

  it("opens the AI input", () => {
    const onAiInput = vi.fn();
    renderWithProviders(<Header onAiInput={onAiInput} />);

    fireEvent.click(screen.getByRole("button", { name: "一句话记账" }));

    expect(onAiInput).toHaveBeenCalled();
  });

  it("hides the buttons it was not given", () => {
    renderWithProviders(<Header />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
