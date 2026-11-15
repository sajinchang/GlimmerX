import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AiInputDialog } from "@/components/transactions/AiInputDialog";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: {
    aiParseTransaction: vi.fn(),
    quickAddTransaction: vi.fn(),
    transactionDelete: vi.fn(),
    accountCreate: vi.fn(),
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

// The two side doors are tested on their own; here they only have to open.
vi.mock("@/components/transactions/QuickAddDialog", () => ({
  QuickAddDialog: ({
    open,
    onSuccess,
    onOpenChange,
  }: {
    open: boolean;
    onSuccess?: (transaction: unknown) => void;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="quick-add">
        <button onClick={() => onSuccess?.({ id: "tx-new" })}>commit</button>
        <button onClick={() => onOpenChange?.(false)}>dismiss</button>
      </div>
    ) : null,
}));

import { toast } from "sonner";
import { clickOption, openSelect } from "@/test-utils/radix";

const PROPOSAL = {
  action: "expense",
  amount: "18.00",
  date: "2026-11-15",
  description: "午饭",
  sourceAccount: { id: "acc-cash", name: "现金" },
  categoryName: "餐饮",
  warnings: [],
};

const TRANSACTION = {
  id: "tx-1",
  date: "2026-11-15",
  description: "午饭",
  createdAt: "2026-11-15T10:00:00+08:00",
  updatedAt: "2026-11-15T10:00:00+08:00",
  postings: [],
};

function textarea() {
  return screen.getByRole("textbox", { name: "一句话记账" });
}

function type(text: string) {
  fireEvent.change(textarea(), { target: { value: text } });
}

describe("AiInputDialog", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.aiParseTransaction.mockResolvedValue(PROPOSAL);
    api.quickAddTransaction.mockResolvedValue(TRANSACTION);
    api.transactionDelete.mockResolvedValue(undefined);
    api.accountCreate.mockResolvedValue({ id: "acc-new" });
  });

  it("shows what the reader could say", () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByText("午饭 18")).toBeInTheDocument();
    expect(screen.getByText("昨天打车 32 支付宝")).toBeInTheDocument();
    expect(screen.getByText("发工资 8000 到招行")).toBeInTheDocument();
  });

  it("takes an example as the sentence", () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByText("午饭 18"));

    expect(textarea()).toHaveValue("午饭 18");
  });

  it("reads the sentence and writes it down", async () => {
    const onSuccess = vi.fn();
    renderWithProviders(
      <AiInputDialog open onOpenChange={vi.fn()} onSuccess={onSuccess} />,
    );

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));

    await waitFor(() =>
      expect(api.aiParseTransaction).toHaveBeenCalledWith("午饭 18"),
    );
    expect(await screen.findByText("已记入账本")).toBeInTheDocument();
    expect(api.quickAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "18.00", description: "午饭" }),
    );
    expect(onSuccess).toHaveBeenCalled();
  });

  it("submits with the keyboard", async () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.keyDown(textarea(), {
      key: "Enter",
      ctrlKey: true,
    });

    await waitFor(() =>
      expect(api.aiParseTransaction).toHaveBeenCalledWith("午饭 18"),
    );
  });

  it("keeps the sentence when the AI does not understand it", async () => {
    api.aiParseTransaction.mockRejectedValue(new Error("看不懂"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));

    expect(await screen.findByText("没看懂这句话")).toBeInTheDocument();
    expect(screen.getByText("看不懂")).toBeInTheDocument();
    expect(textarea()).toHaveValue("午饭 18");
  });

  it("lets the reader say it differently", async () => {
    api.aiParseTransaction.mockRejectedValue(new Error("看不懂"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("没看懂这句话");

    fireEvent.click(screen.getByRole("button", { name: "换个说法" }));

    expect(screen.queryByText("没看懂这句话")).toBeNull();
  });

  it("writes the transaction by hand when the AI gives up", async () => {
    api.aiParseTransaction.mockRejectedValue(new Error("看不懂"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("没看懂这句话");

    fireEvent.click(screen.getByRole("button", { name: "手动记一笔" }));

    expect(screen.getByTestId("quick-add")).toBeInTheDocument();
  });

  it("reports a transaction it could not write", async () => {
    api.quickAddTransaction.mockRejectedValue(new Error("写不进去"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));

    expect(await screen.findByText("没有写入任何记录")).toBeInTheDocument();
    expect(screen.getByText("写不进去")).toBeInTheDocument();
  });

  it("tries the same proposal again", async () => {
    api.quickAddTransaction.mockRejectedValueOnce(new Error("写不进去"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("没有写入任何记录");

    api.quickAddTransaction.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(api.quickAddTransaction).toHaveBeenCalled());
  });

  it("takes the entry back", async () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("已记入账本");

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    await waitFor(() =>
      expect(api.transactionDelete).toHaveBeenCalledWith("tx-1"),
    );
    expect(toast.success).toHaveBeenCalledWith("已撤销");
  });

  it("takes the entry back with the keyboard", async () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("已记入账本");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() =>
      expect(api.transactionDelete).toHaveBeenCalledWith("tx-1"),
    );
  });

  it("says when the entry could not be taken back", async () => {
    api.transactionDelete.mockRejectedValue(new Error("撤销失败"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("已记入账本");

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "撤销失败，可在交易列表里删除: 撤销失败",
      ),
    );
  });

  it("opens the entry for a correction", async () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("已记入账本");

    fireEvent.click(screen.getByRole("button", { name: "改一下" }));

    expect(screen.getByTestId("quick-add")).toBeInTheDocument();
  });

  it("asks before it creates an account", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "create_account",
      amount: "",
      date: "2026-11-15",
      description: "开了张卡",
      accountPath: "资产/支付宝",
      accountKind: "asset",
      openingBalance: "100.00",
      warnings: [],
    });
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("开了一张支付宝卡");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));

    expect(await screen.findByText("新建账户")).toBeInTheDocument();
    expect(
      (document.querySelector("#ai-account-path") as HTMLInputElement).value,
    ).toBe("资产/支付宝");

    fireEvent.click(screen.getByRole("button", { name: "创建账户" }));

    await waitFor(() =>
      expect(api.accountCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "资产/支付宝" }),
      ),
    );
  });

  it("goes back to the sentence when the account is not wanted", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "create_account",
      amount: "",
      date: "2026-11-15",
      description: "开了张卡",
      accountPath: "资产/支付宝",
      warnings: [],
    });
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("开了一张支付宝卡");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("新建账户");

    fireEvent.click(screen.getByRole("button", { name: "重新输入" }));

    expect(screen.queryByText("新建账户")).toBeNull();
  });

  it("reports an account it could not create", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "create_account",
      amount: "",
      date: "2026-11-15",
      description: "开了张卡",
      accountPath: "资产/支付宝",
      warnings: [],
    });
    api.accountCreate.mockRejectedValue(new Error("建不了"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("开了一张支付宝卡");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("新建账户");

    fireEvent.click(screen.getByRole("button", { name: "创建账户" }));

    expect(await screen.findByText("建不了")).toBeInTheDocument();
  });

  it("keeps the undo in the toast when the receipt is closed", async () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("已记入账本");

    fireEvent.click(screen.getByRole("button", { name: "好了" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("已记入"),
        expect.objectContaining({ action: expect.any(Object) }),
      ),
    );
  });

  it("will not record an empty sentence", () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "记账" })).toBeDisabled();
  });
});

describe("AiInputDialog side doors", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.aiParseTransaction.mockResolvedValue(PROPOSAL);
    api.quickAddTransaction.mockResolvedValue(TRANSACTION);
    api.transactionDelete.mockResolvedValue(undefined);
    api.accountCreate.mockResolvedValue({ id: "acc-new" });
  });

  it("offers the undo in the toast for a hand-written entry", async () => {
    api.aiParseTransaction.mockRejectedValue(new Error("看不懂"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("没看懂这句话");

    fireEvent.click(screen.getByRole("button", { name: "手动记一笔" }));
    fireEvent.click(screen.getByRole("button", { name: "commit" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("已记入"),
        expect.objectContaining({ action: expect.any(Object) }),
      ),
    );
  });

  it("offers the undo in the toast for a corrected entry", async () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("已记入账本");

    fireEvent.click(screen.getByRole("button", { name: "改一下" }));
    fireEvent.click(screen.getByRole("button", { name: "commit" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "已覆盖原记录",
        expect.objectContaining({ action: expect.any(Object) }),
      ),
    );
  });

  it("reads an income without a source account", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "income",
      amount: "8000.00",
      date: "2026-11-15",
      description: "发工资",
      destinationAccount: { id: "acc-bank", name: "招行" },
      warnings: [],
    });
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("发工资 8000 到招行");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));

    await waitFor(() =>
      expect(api.quickAddTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "income",
          sourceAccountId: undefined,
          destinationAccountId: "acc-bank",
        }),
      ),
    );
  });

  it("creates a liability when the reader says so", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "create_account",
      amount: "",
      date: "2026-11-15",
      description: "开了张卡",
      accountPath: "负债/信用卡",
      accountKind: "liability",
      warnings: [],
    });
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("开了一张信用卡");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));

    expect(await screen.findByText("新建账户")).toBeInTheDocument();
    expect(screen.getAllByText("负债").length).toBeGreaterThan(0);
  });
});

describe("AiInputDialog odds and ends", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.aiParseTransaction.mockResolvedValue(PROPOSAL);
    api.quickAddTransaction.mockResolvedValue(TRANSACTION);
    api.transactionDelete.mockResolvedValue(undefined);
    api.accountCreate.mockResolvedValue({ id: "acc-new" });
  });

  it("reads a proposal that says no amount", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "expense",
      date: "2026-11-15",
      description: "午饭",
      warnings: [],
    });
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));

    await waitFor(() =>
      expect(api.quickAddTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "" }),
      ),
    );
  });

  it("creates an account the proposal gave no date for", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "create_account",
      amount: "",
      description: "开了张卡",
      accountPath: "资产/支付宝",
      warnings: [],
    });
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("开了一张卡");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("新建账户");

    fireEvent.click(screen.getByRole("button", { name: "创建账户" }));

    await waitFor(() =>
      expect(api.accountCreate).toHaveBeenCalledWith(
        expect.objectContaining({ initial_balance_date: undefined }),
      ),
    );
  });

  it("asks for the path of an account that has none", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "create_account",
      amount: "",
      date: "2026-11-15",
      description: "开了张卡",
      warnings: [],
    });
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("开了一张卡");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));

    expect(await screen.findByText("新建账户")).toBeInTheDocument();
    expect(
      (document.querySelector("#ai-account-path") as HTMLInputElement).value,
    ).toBe("");
  });

  it("lets the reader change the kind of the account", async () => {
    api.aiParseTransaction.mockResolvedValue({
      action: "create_account",
      amount: "",
      date: "2026-11-15",
      description: "开了张卡",
      accountPath: "资产/支付宝",
      warnings: [],
    });
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("开了一张卡");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("新建账户");

    const trigger = screen.getByRole("combobox");
    await openSelect(trigger);
    clickOption("负债");

    expect(screen.getAllByText("负债").length).toBeGreaterThan(0);
  });

  it("closes without an entry to undo", () => {
    vi.mocked(toast.success).mockClear();
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(toast.success).not.toHaveBeenCalled();
  });

  it("ignores the keys it does not listen to", async () => {
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.keyDown(textarea(), { key: "Enter" });
    await waitFor(() => expect(api.aiParseTransaction).not.toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(api.transactionDelete).not.toHaveBeenCalled();
  });

  it("offers a new try when the transaction could not be written", async () => {
    api.quickAddTransaction.mockRejectedValue(new Error("写不进去"));
    renderWithProviders(<AiInputDialog open onOpenChange={vi.fn()} />);

    type("午饭 18");
    fireEvent.click(screen.getByRole("button", { name: "记账" }));
    await screen.findByText("没有写入任何记录");

    api.quickAddTransaction.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(api.quickAddTransaction).toHaveBeenCalled());
  });
});
