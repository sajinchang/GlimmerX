import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

// Mock error translation
vi.mock("@/utils/errorTranslation", () => ({
  translateErrorMessage: vi.fn((err) => String(err)),
}));

import {
  aiParseTransaction,
  accountCreate,
  quickAddTransaction,
  transactionDelete,
} from "@/utils/api";

const mockAiParse = aiParseTransaction as ReturnType<typeof vi.fn>;
const mockAccountCreate = accountCreate as ReturnType<typeof vi.fn>;
const mockQuickAdd = quickAddTransaction as ReturnType<typeof vi.fn>;
const mockDelete = transactionDelete as ReturnType<typeof vi.fn>;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const expenseProposal = {
  action: "expense",
  amount: "12.50",
  date: "2026-11-14",
  description: "lunch",
  sourceAccount: { id: "acc-1", name: "WeChat" },
  categoryName: "餐饮",
  warnings: ["分类「餐饮」是新建的"],
};

describe("AiInputDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders input and button when open", () => {
    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/中午吃饭|Lunch/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /识别并录入|Parse/i }),
    ).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    renderWithProviders(<AiInputDialog open={false} onOpenChange={vi.fn()} />);
    expect(
      screen.queryByPlaceholderText(/中午吃饭|Lunch/i),
    ).not.toBeInTheDocument();
  });

  it("writes immediately and shows an undoable receipt", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-1" });
    const onOpenChange = vi.fn();

    renderWithProviders(
      <AiInputDialog open={true} onOpenChange={onOpenChange} />,
    );

    const input = screen.getByPlaceholderText(/中午吃饭|Lunch/i);
    fireEvent.change(input, { target: { value: "中午吃饭18元" } });

    fireEvent.click(screen.getByRole("button", { name: /识别并录入|Parse/i }));

    await waitFor(() => {
      expect(mockAiParse).toHaveBeenCalledWith("中午吃饭18元");
    });

    // Optimistic write (design doc 25, §4.2): the transaction is committed
    // before the user sees anything, with semantic fields only — the client
    // never builds postings.
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

    // The receipt is not a gate: the dialog stays open so the user can look,
    // undo, or correct — but nothing waits on them.
    await waitFor(() => {
      expect(
        screen.getByText(/已录入，看看对不对|Saved — does this look right/),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("proposal-review")).toBeInTheDocument();
    expect(screen.getByText(/分类「餐饮」是新建的/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /撤销|Undo/ }),
    ).toBeInTheDocument();
  });

  it("undo deletes the transaction it just wrote", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockResolvedValueOnce({ id: "tx-1" });
    mockDelete.mockResolvedValueOnce(undefined);

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/中午吃饭|Lunch/i), {
      target: { value: "中午吃饭18元" },
    });
    fireEvent.click(screen.getByRole("button", { name: /识别并录入|Parse/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /撤销|Undo/ }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /撤销|Undo/ }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("tx-1");
    });
  });

  it("returns to the input stage when the write is rejected", async () => {
    mockAiParse.mockResolvedValueOnce(expenseProposal);
    mockQuickAdd.mockRejectedValueOnce(new Error("errors.databaseLocked"));

    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/中午吃饭|Lunch/i), {
      target: { value: "中午吃饭18元" },
    });
    fireEvent.click(screen.getByRole("button", { name: /识别并录入|Parse/i }));

    await waitFor(() => {
      expect(screen.getByText(/errors\.databaseLocked/)).toBeInTheDocument();
    });
    // Nothing was written, so the user is back where they started.
    expect(screen.getByPlaceholderText(/中午吃饭|Lunch/i)).toBeInTheDocument();
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
    const onOpenChange = vi.fn();

    renderWithProviders(
      <AiInputDialog open={true} onOpenChange={onOpenChange} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/中午吃饭|Lunch/i), {
      target: { value: "新建支付宝账户余额1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /识别并录入|Parse/i }));

    await waitFor(() => {
      expect(screen.getByText("确认记账")).toBeInTheDocument();
    });
    // Path and opening balance are prefilled and editable.
    expect(
      (screen.getByLabelText(/账户路径|Account path/i) as HTMLInputElement)
        .value,
    ).toBe("Assets/支付宝");

    // Confirming creates the account through the existing command.
    mockAccountCreate.mockResolvedValueOnce({ id: "acc-9" });
    fireEvent.click(screen.getByRole("button", { name: /保存|Save|确认/i }));
    await waitFor(() => {
      expect(mockAccountCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Assets/支付宝" }),
      );
    });
  });

  it("shows error on failure without closing dialog", async () => {
    mockAiParse.mockRejectedValueOnce(new Error("errors.ai.noApiKey"));
    const onOpenChange = vi.fn();

    renderWithProviders(
      <AiInputDialog open={true} onOpenChange={onOpenChange} />,
    );

    const input = screen.getByPlaceholderText(/中午吃饭|Lunch/i);
    fireEvent.change(input, { target: { value: "test" } });

    const button = screen.getByRole("button", { name: /识别并录入|Parse/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/errors\.ai\.noApiKey/i)).toBeInTheDocument();
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("disables submit button when text is empty", () => {
    renderWithProviders(<AiInputDialog open={true} onOpenChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: /识别并录入|Parse/i });
    expect(button).toBeDisabled();
  });
});
