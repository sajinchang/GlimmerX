import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { renderWithProviders } from "@/test-utils/render";

const { session } = vi.hoisted(() => ({
  session: { lockSession: vi.fn() },
}));

vi.mock("@/utils/session", () => ({ lockSession: session.lockSession }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

import { toast } from "sonner";

describe("Sidebar", () => {
  beforeEach(() => {
    session.lockSession.mockReset();
    session.lockSession.mockResolvedValue(true);
  });

  it("links to every page", () => {
    renderWithProviders(<Sidebar />);

    expect(screen.getByText("概览")).toBeInTheDocument();
    expect(screen.getByText("账户")).toBeInTheDocument();
    expect(screen.getByText("交易")).toBeInTheDocument();
    expect(screen.getByText("分类")).toBeInTheDocument();
    expect(screen.getByText("预算")).toBeInTheDocument();
    expect(screen.getByText("储蓄目标")).toBeInTheDocument();
    expect(screen.getByText("报表")).toBeInTheDocument();
    expect(screen.getByText("设置")).toBeInTheDocument();
  });

  it("locks the ledger", async () => {
    renderWithProviders(<Sidebar />);

    fireEvent.click(screen.getByText("锁屏"));

    await waitFor(() => expect(session.lockSession).toHaveBeenCalled());
  });

  it("switches to another ledger", async () => {
    renderWithProviders(<Sidebar />);

    fireEvent.click(screen.getByText("切换账本"));

    await waitFor(() => expect(session.lockSession).toHaveBeenCalled());
  });

  it("says so when the ledger refuses to lock", async () => {
    session.lockSession.mockResolvedValue(false);
    renderWithProviders(<Sidebar />);

    fireEvent.click(screen.getByText("锁屏"));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
