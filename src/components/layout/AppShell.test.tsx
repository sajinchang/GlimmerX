import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));
vi.mock("@/components/layout/Header", () => ({
  Header: ({
    onQuickAdd,
    onAiInput,
  }: {
    onQuickAdd?: () => void;
    onAiInput?: () => void;
  }) => (
    <div>
      <button onClick={onQuickAdd}>quick</button>
      <button onClick={onAiInput}>ai</button>
    </div>
  ),
}));
vi.mock("@/components/transactions/QuickAddDialog", () => ({
  QuickAddDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="quick-add" /> : null,
}));
vi.mock("@/components/transactions/AiInputDialog", () => ({
  AiInputDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="ai-input" /> : null,
}));

import { AppShell } from "@/components/layout/AppShell";
import { useUiStore } from "@/stores/uiStore";

describe("AppShell", () => {
  beforeEach(() => {
    useUiStore.setState({ quickAddOpen: false });
  });

  it("puts the navigation, the header and the page together", () => {
    renderWithProviders(<AppShell />);

    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "quick" })).toBeInTheDocument();
  });

  it("opens the quick add dialog", () => {
    renderWithProviders(<AppShell />);

    fireEvent.click(screen.getByRole("button", { name: "quick" }));

    expect(screen.getByTestId("quick-add")).toBeInTheDocument();
  });

  it("opens the AI input", () => {
    renderWithProviders(<AppShell />);

    fireEvent.click(screen.getByRole("button", { name: "ai" }));

    expect(screen.getByTestId("ai-input")).toBeInTheDocument();
  });

  it("opens the AI input with the keyboard", () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: "I", ctrlKey: true, shiftKey: true });

    expect(screen.getByTestId("ai-input")).toBeInTheDocument();
  });

  it("leaves the AI input alone for other keys", () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: "i", ctrlKey: true, shiftKey: true });

    expect(screen.queryByTestId("ai-input")).toBeNull();
  });
});
