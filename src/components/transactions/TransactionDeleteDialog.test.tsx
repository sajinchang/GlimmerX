import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { TransactionDeleteDialog } from "@/components/transactions/TransactionDeleteDialog";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: { transactionDeletePreview: vi.fn(), transactionDelete: vi.fn() },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const PREVIEW = {
  transactionId: "t1",
  description: "买菜",
  date: "2026-11-05",
  postingCount: 2,
  canDelete: true,
  warningMessage: null,
};

describe("TransactionDeleteDialog", () => {
  beforeEach(() => {
    api.transactionDeletePreview.mockReset();
    api.transactionDelete.mockReset();
    api.transactionDeletePreview.mockResolvedValue(PREVIEW);
    api.transactionDelete.mockResolvedValue(undefined);
  });

  it("shows what is about to be deleted", async () => {
    renderWithProviders(
      <TransactionDeleteDialog
        transactionId="t1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("买菜")).toBeInTheDocument();
    expect(screen.getByText("2 条分录")).toBeInTheDocument();
  });

  it("names a transaction without a description", async () => {
    api.transactionDeletePreview.mockResolvedValue({
      ...PREVIEW,
      description: "",
    });
    renderWithProviders(
      <TransactionDeleteDialog
        transactionId="t1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("无描述")).toBeInTheDocument();
  });

  it("warns about what the deletion will break", async () => {
    api.transactionDeletePreview.mockResolvedValue({
      ...PREVIEW,
      warningMessage: "该交易被预算引用",
    });
    renderWithProviders(
      <TransactionDeleteDialog
        transactionId="t1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("该交易被预算引用")).toBeInTheDocument();
  });

  it("refuses to delete a transaction that cannot be deleted", async () => {
    api.transactionDeletePreview.mockResolvedValue({
      ...PREVIEW,
      canDelete: false,
    });
    renderWithProviders(
      <TransactionDeleteDialog
        transactionId="t1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await screen.findByText("买菜");
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });

  it("deletes the transaction", async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    renderWithProviders(
      <TransactionDeleteDialog
        transactionId="t1"
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
    );
    await screen.findByText("买菜");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(api.transactionDelete).toHaveBeenCalledWith("t1"),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it("reports a preview it cannot read", async () => {
    api.transactionDeletePreview.mockRejectedValue(new Error("读取失败"));
    renderWithProviders(
      <TransactionDeleteDialog
        transactionId="t1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("读取失败")).toBeInTheDocument();
  });

  it("reports a deletion that failed", async () => {
    api.transactionDelete.mockRejectedValue(new Error("删除失败"));
    renderWithProviders(
      <TransactionDeleteDialog
        transactionId="t1"
        open
        onOpenChange={vi.fn()}
      />,
    );
    await screen.findByText("买菜");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(await screen.findByText("删除失败")).toBeInTheDocument();
  });
});
