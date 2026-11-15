import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiInputDialog } from "./AiInputDialog";

// Mock the API module. Every function the rendered tree may touch must exist,
// because the confirmation card mounts QuickAddDialog (queries included).
vi.mock("@/utils/api", () => ({
  setUiLanguage: vi.fn().mockResolvedValue(undefined),
  aiParseTransaction: vi.fn(),
  quickAddTransaction: vi.fn(),
  quickReplaceTransaction: vi.fn(),
  transactionDelete: vi.fn(),
  accountCreate: vi.fn(),
  accountList: vi.fn().mockResolvedValue([]),
  categoryList: vi.fn().mockResolvedValue([]),
}));

// The undo offer after closing lives in a toast, so it has to be observable.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

// Mock error translation
vi.mock("@/utils/errorTranslation", () => ({
  translateErrorMessage: vi.fn((err) => String(err)),
}));

import {
  aiParseTransaction,
  accountCreate,
  quickAddTransaction,
  quickReplaceTransaction,
  accountList,
  transactionDelete,
} from "@/utils/api";
import { toast } from "sonner";

const mockAiParse = aiParseTransaction as ReturnType<typeof vi.fn>;
const mockAccountCreate = accountCreate as ReturnType<typeof vi.fn>;
const mockQuickAdd = quickAddTransaction as ReturnType<typeof vi.fn>;
const mockDelete = transactionDelete as ReturnType<typeof vi.fn>;
const mockReplace = quickReplaceTransaction as ReturnType<typeof vi.fn>;
const mockAccounts = accountList as ReturnType<typeof vi.fn>;
const mockToastSuccess = toast.success as ReturnType<typeof vi.fn>;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** The suite runs in one locale, but assertions should not depend on which. */
const INPUT = /午饭|Lunch/i;
const SUBMIT = /记账|Record/;
const RECEIPT_STATUS = /已记入账本|Added to the ledger/;
const SAVING_STATUS = /正在写入|Writing/;
const UNDO = /撤销|Undo/;
const DONE = /好了|Done/;

const expenseProposal = {
  action: "expense",
  amount: "12.50",
  date: "2026-11-14",
  description: "lunch",
  sourceAccount: { id: "acc-1", name: "WeChat" },
  categoryName: "餐饮",
  warnings: ["分类「餐饮」是新建的"],
};

function typeAndSubmit(text: string) {
  fireEvent.change(screen.getByPlaceholderText(INPUT), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: SUBMIT }));
}

describe("AiInputDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the composer and the examples when open", () => {
    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(INPUT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SUBMIT })).toBeInTheDocument();
    // An empty box is a dead end; the chips show what the box understands.
    expect(screen.getByRole("button", { name: /18/ })).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    renderWithProviders(<AiInputDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByPlaceholderText(INPUT)).not.toBeInTheDocument();
  });

  it("shows what will be written before the write resolves", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    // Hold the write open: the receipt must already describe it.
    let resolveWrite: (value: { id: string }) => void = () => {};
    mockQuickAdd.mockReturnValueOnce(
      new Promise<{ id: string }>((resolve) => {
        resolveWrite = resolve;
      }),
    );

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("中午吃饭18元");

    await waitFor(() => {
      expect(screen.getByTestId("ai-receipt")).toBeInTheDocument();
    });
    expect(screen.getByTestId("ai-receipt-status")).toHaveTextContent(
      SAVING_STATUS,
    );
    // The fields are on screen before the ledger has them — this is what the
    // old flow could not do (it wrote first, then showed a receipt).
    expect(screen.getByText("¥12.50")).toBeInTheDocument();
    expect(screen.getByTestId("ai-receipt-warnings")).toBeInTheDocument();
    // No undo until there is something to undo.
    expect(
      screen.queryByRole("button", { name: UNDO }),
    ).not.toBeInTheDocument();

    resolveWrite({ id: "tx-1" });

    await waitFor(() => {
      expect(screen.getByTestId("ai-receipt-status")).toHaveTextContent(
        RECEIPT_STATUS,
      );
    });
    expect(screen.getByRole("button", { name: UNDO })).toBeInTheDocument();
  });

  it("writes semantic fields only, never postings", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-1" });

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("中午吃饭18元");

    await waitFor(() => {
      expect(mockQuickAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "expense",
          amount: "12.50",
          sourceAccountId: "acc-1",
          categoryName: "餐饮",
        }),
      );
    });
  });

  it("submits on Ctrl+Enter but keeps Enter for newlines", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-1" });

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(INPUT);
    fireEvent.change(input, { target: { value: "午饭 18" } });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockAiParse).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(mockAiParse).toHaveBeenCalledWith("午饭 18");
    });
  });

  it("undo deletes the entry and keeps the sentence for a retry", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-1" });
    mockDelete.mockResolvedValueOnce(undefined);

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("中午吃饭18元");

    const undo = await screen.findByRole("button", { name: UNDO });
    fireEvent.click(undo);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("tx-1");
    });
    // Back to writing, not out of the dialog: "say it differently" is the usual
    // next step, and the old flow threw the sentence away.
    await waitFor(() => {
      expect(screen.queryByTestId("ai-receipt")).not.toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(INPUT)).toHaveValue("中午吃饭18元");
  });

  it("offers undo in a toast when the receipt is closed", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-1" });
    const onOpenChange = vi.fn();

    renderWithProviders(
      <AiInputDialog open={true} onOpenChange={onOpenChange} />,
    );
    typeAndSubmit("中午吃饭18元");

    fireEvent.click(await screen.findByRole("button", { name: DONE }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The escape hatch outlives the dialog: closing is not a commitment.
    const calls = mockToastSuccess.mock.calls;
    const options = calls[calls.length - 1]?.[1];
    expect(options?.action?.label).toMatch(UNDO);
  });

  it("hands the previous receipt's undo to the toast when a new one starts", async () => {
    mockAiParse.mockResolvedValue(expenseProposal);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-1" });

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("中午吃饭18元");
    await screen.findByRole("button", { name: UNDO });

    // The second sentence replaces the receipt on screen; the first entry must
    // not silently lose the only way to undo it.
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-2" });
    typeAndSubmit("晚饭 30");

    await waitFor(() => {
      const calls = mockToastSuccess.mock.calls;
      expect(calls[calls.length - 1]?.[1]?.action?.label).toMatch(UNDO);
    });
  });

  it("does not resurrect a receipt when the write lands after closing", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    let resolveWrite: (value: { id: string }) => void = () => {};
    mockQuickAdd.mockReturnValueOnce(
      new Promise<{ id: string }>((resolve) => {
        resolveWrite = resolve;
      }),
    );

    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>host-close</button>
          <button onClick={() => setOpen(true)}>host-open</button>
          <AiInputDialog open={open} onOpenChange={setOpen} />
        </>
      );
    }
    renderWithProviders(<Host />);

    typeAndSubmit("午饭 18");
    await waitFor(() => {
      expect(screen.getByTestId("ai-receipt")).toBeInTheDocument();
    });

    // Closed while the write is still in flight.
    fireEvent.click(screen.getByText("host-close"));
    resolveWrite({ id: "tx-1" });

    // The entry exists, so the escape hatch must reach the user anyway.
    await waitFor(() => {
      const calls = mockToastSuccess.mock.calls;
      expect(calls[calls.length - 1]?.[1]?.action?.label).toMatch(UNDO);
    });

    fireEvent.click(screen.getByText("host-open"));
    // Nothing from the previous session may come back: a stale receipt would
    // mean a stray Ctrl+Z deletes a transaction the user cannot see.
    expect(screen.queryByTestId("ai-receipt")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: DONE }),
    ).not.toBeInTheDocument();
  });

  it("replacing an entry is destructive, and its undo deletes the replacement", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-1" });
    mockReplace.mockResolvedValueOnce({ id: "tx-2" });
    mockDelete.mockResolvedValue(undefined);

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("中午吃饭18元");

    fireEvent.click(
      await screen.findByRole("button", { name: /改一下|Fix it/ }),
    );

    // The form behind "改一下" is an edit form, not the generic quick-add.
    expect(
      await screen.findByRole("heading", {
        name: /修改这一笔|Edit this entry/,
      }),
    ).toBeInTheDocument();
    // The original row is gone after this: the button has to say so.
    const submit = screen.getByRole("button", {
      name: /保存并覆盖|Save and replace/,
    });

    fireEvent.click(submit);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "tx-1",
        expect.objectContaining({ amount: "12.50" }),
      );
    });

    // Undo cannot bring the original back, but it can remove the replacement —
    // better than leaving a wrong entry behind.
    const calls = mockToastSuccess.mock.calls;
    const options = calls[calls.length - 1]?.[1];
    expect(options?.action?.label).toMatch(UNDO);
    options.action.onClick();
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("tx-2");
    });
  });

  it("offers undo for an entry typed by hand", async () => {
    mockAiParse.mockRejectedValueOnce(new Error("errors.ai.noApiKey"));
    mockAccounts.mockResolvedValue([
      { id: "acc-1", name: "WeChat", account_type: "asset", is_active: true },
    ]);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-9" });
    mockDelete.mockResolvedValue(undefined);

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("早饭一共付了十几块");
    fireEvent.click(
      await screen.findByRole("button", {
        name: /手动记一笔|Enter it manually/,
      }),
    );

    const amount = document.getElementById(
      "quick-add-amount",
    ) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "20" } });

    fireEvent.click(document.getElementById("source-account") as HTMLElement);
    fireEvent.click(await screen.findByRole("option", { name: "WeChat" }));

    fireEvent.click(screen.getByRole("button", { name: /保存|Save/ }));

    await waitFor(() => {
      expect(mockQuickAdd).toHaveBeenCalled();
    });
    // Same escape hatch as an AI-written entry: the manual form is not a
    // second-class write.
    const calls = mockToastSuccess.mock.calls;
    const options = calls[calls.length - 1]?.[1];
    expect(options?.action?.label).toMatch(UNDO);
    options.action.onClick();
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("tx-9");
    });
  });

  it("separates a parse failure from a write failure", async () => {
    mockAiParse.mockRejectedValueOnce(new Error("errors.ai.noApiKey"));
    const onOpenChange = vi.fn();

    renderWithProviders(
      <AiInputDialog open={true} onOpenChange={onOpenChange} />,
    );
    typeAndSubmit("test");

    // The AI never understood the sentence: nothing exists to undo.
    expect(await screen.findByTestId("ai-error")).toHaveTextContent(
      /没看懂|Could not read/,
    );
    expect(screen.getByTestId("ai-error")).toHaveTextContent(
      "Error: errors.ai.noApiKey",
    );
    expect(screen.getByPlaceholderText(INPUT)).toHaveValue("test");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("reports a rejected write as nothing written, and can retry", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockRejectedValueOnce(new Error("errors.databaseLocked"));

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("中午吃饭18元");

    const card = await screen.findByTestId("ai-error");
    expect(card).toHaveTextContent(/没有写入|Nothing was written/);
    expect(card).toHaveTextContent("Error: errors.databaseLocked");

    // The proposal is still around, so a retry does not re-run the AI.
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-2" });
    fireEvent.click(screen.getByRole("button", { name: /重试|Retry/ }));

    await waitFor(() => {
      expect(mockQuickAdd).toHaveBeenCalledTimes(2);
    });
    expect(mockAiParse).toHaveBeenCalledTimes(1);
  });

  it("hands a failed sentence to the manual form instead of dropping it", async () => {
    mockAiParse.mockRejectedValueOnce(new Error("errors.ai.noApiKey"));

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("早饭一共付了十几块");

    fireEvent.click(
      await screen.findByRole("button", {
        name: /手动记一笔|Enter it manually/,
      }),
    );

    // The typed sentence arrives as the description of the blank form.
    await waitFor(() => {
      expect(
        screen.getByDisplayValue("早饭一共付了十几块"),
      ).toBeInTheDocument();
    });
  });

  it("routes create_account proposals to the account confirmation card", async () => {
    mockAiParse.mockResolvedValueOnce({
      action: "create_account",
      date: "2026-11-14",
      description: "新建支付宝",
      accountPath: "Assets/支付宝",
      accountKind: "asset",
      openingBalance: "1000.00",
      warnings: [],
    });

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    typeAndSubmit("新建支付宝账户余额1000");

    // The heading, not the text: "新建账户" is also the proposal's action label.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /新建账户|New account/ }),
      ).toBeInTheDocument();
    });
    expect(
      (screen.getByLabelText(/账户路径|Account path/i) as HTMLInputElement)
        .value,
    ).toBe("Assets/支付宝");

    mockAccountCreate.mockResolvedValueOnce({ id: "acc-9" });
    fireEvent.click(
      screen.getByRole("button", { name: /创建账户|Create account/ }),
    );
    await waitFor(() => {
      expect(mockAccountCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Assets/支付宝" }),
      );
    });
  });

  it("disables submit button when text is empty", () => {
    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
  });
});
