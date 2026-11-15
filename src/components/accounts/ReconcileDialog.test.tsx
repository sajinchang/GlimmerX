import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ReconcileDialog } from "@/components/accounts/ReconcileDialog";
import { renderWithProviders } from "@/test-utils/render";
import { toast } from "sonner";

const { api } = vi.hoisted(() => ({
  api: {
    reconcilePreview: vi.fn(),
    reconcileList: vi.fn(),
    reconcileTotals: vi.fn(),
    reconcileAutoMatch: vi.fn(),
    reconcileCreate: vi.fn(),
    reconcileUndo: vi.fn(),
  },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const PREVIEW = {
  accountId: "acc1",
  statementDate: "2026-11-15",
  openingBalance: 100000,
  candidates: [
    {
      postingId: "p1",
      transactionId: "t1",
      date: "2026-11-10",
      description: "买菜",
      amount: -5000,
    },
    {
      postingId: "p2",
      transactionId: "t2",
      date: "2026-11-12",
      description: "",
      amount: 20000,
    },
  ],
};

const TOTALS = {
  openingBalance: 100000,
  selectedTotal: 15000,
  expectedBalance: 115000,
  difference: 0,
  balanced: true,
};

const HISTORY = [
  {
    id: "r1",
    accountId: "acc1",
    statementDate: "2026-10-31",
    openingBalance: 50000,
    closingBalance: 90000,
    createdAt: "2026-11-01T10:00:00+08:00",
  },
];

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountName: string;
  onSuccess: () => void;
}

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const props: DialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    accountId: "acc1",
    accountName: "现金",
    onSuccess: vi.fn(),
    ...overrides,
  };
  return {
    ...renderWithProviders(<ReconcileDialog {...props} />),
    props,
  };
}

describe("ReconcileDialog", () => {
  beforeEach(() => {
    api.reconcilePreview.mockReset();
    api.reconcileList.mockReset();
    api.reconcileTotals.mockReset();
    api.reconcileAutoMatch.mockReset();
    api.reconcileCreate.mockReset();
    api.reconcileUndo.mockReset();
    api.reconcilePreview.mockResolvedValue(PREVIEW);
    api.reconcileList.mockResolvedValue(HISTORY);
    api.reconcileTotals.mockResolvedValue(TOTALS);
    api.reconcileAutoMatch.mockResolvedValue({
      matched: ["p1"],
      unmatchedTargets: 0,
    });
    api.reconcileCreate.mockResolvedValue("rec-1");
    api.reconcileUndo.mockResolvedValue(undefined);
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.warning as ReturnType<typeof vi.fn>).mockClear();
  });

  it("lists the postings that are still unreconciled", async () => {
    renderDialog();
    expect(await screen.findByText("对账 · 现金")).toBeInTheDocument();
    expect(await screen.findByText("买菜")).toBeInTheDocument();
    // A posting without a description still needs a name.
    expect(screen.getByText("无描述")).toBeInTheDocument();
    expect(screen.getByText("2026-11-10")).toBeInTheDocument();
    expect(screen.getByText("-¥50.00")).toBeInTheDocument();
  });

  it("shows the balance the selection leads to", async () => {
    renderDialog();
    await screen.findByText("买菜");

    expect(screen.getByText("期初已对账")).toBeInTheDocument();
    expect(screen.getByText("¥1,000.00")).toBeInTheDocument();
    expect(screen.getByText("本次勾选")).toBeInTheDocument();
    expect(screen.getByText("¥150.00")).toBeInTheDocument();
    expect(screen.getByText("对账后余额")).toBeInTheDocument();
    expect(screen.getByText("¥1,150.00")).toBeInTheDocument();
    expect(screen.getByText("差额")).toBeInTheDocument();
  });

  it("says so when there is nothing left to reconcile", async () => {
    api.reconcilePreview.mockResolvedValue({ ...PREVIEW, candidates: [] });
    renderDialog();
    expect(
      await screen.findByText("该日期之前没有未对账的分录"),
    ).toBeInTheDocument();
  });

  it("matches the statement amounts to the postings", async () => {
    api.reconcileAutoMatch.mockResolvedValue({
      matched: ["p1"],
      unmatchedTargets: 2,
    });
    renderDialog();
    await screen.findByText("买菜");

    fireEvent.change(screen.getByPlaceholderText(/每行一个金额/), {
      target: { value: "-50.00\n200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "自动匹配" }));

    await waitFor(() =>
      expect(api.reconcileAutoMatch).toHaveBeenCalledWith(
        "acc1",
        expect.any(String),
        ["-50.00", "200"],
      ),
    );
    expect(toast.warning).toHaveBeenCalledWith("2 笔账单金额未找到对应分录");
  });

  it("reports a failed match", async () => {
    api.reconcileAutoMatch.mockRejectedValue(new Error("匹配失败"));
    renderDialog();
    await screen.findByText("买菜");

    fireEvent.change(screen.getByPlaceholderText(/每行一个金额/), {
      target: { value: "-50.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "自动匹配" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("匹配失败"));
  });

  it("keeps the submit button shut until the numbers agree", async () => {
    renderDialog();
    await screen.findByText("买菜");

    const submit = screen.getByRole("button", { name: "完成对账" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "115.00" },
    });

    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("completes the reconciliation once the difference is zero", async () => {
    const { props } = renderDialog();
    await screen.findByText("买菜");

    fireEvent.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "115.00" },
    });
    const submit = screen.getByRole("button", { name: "完成对账" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(api.reconcileCreate).toHaveBeenCalledWith(
        "acc1",
        expect.any(String),
        "115.00",
        ["p1"],
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("对账已完成");
    expect(props.onSuccess).toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reports a failed reconciliation", async () => {
    api.reconcileCreate.mockRejectedValue(new Error("对账失败"));
    renderDialog();
    await screen.findByText("买菜");

    fireEvent.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "115.00" },
    });
    const submit = screen.getByRole("button", { name: "完成对账" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("对账失败"));
  });

  it("undoes a finished reconciliation", async () => {
    const { props } = renderDialog();
    await screen.findByText("已完成的核对");

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    await waitFor(() => expect(api.reconcileUndo).toHaveBeenCalledWith("r1"));
    expect(toast.success).toHaveBeenCalledWith("已撤销对账");
    expect(props.onSuccess).toHaveBeenCalled();
  });

  it("closes without doing anything when the reader cancels", async () => {
    const { props } = renderDialog();
    await screen.findByText("买菜");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(api.reconcileCreate).not.toHaveBeenCalled();
  });
});
