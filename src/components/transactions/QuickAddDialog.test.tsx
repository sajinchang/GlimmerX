import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QuickAddDialog } from "./QuickAddDialog";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: {
    accountList: vi.fn(),
    categoryList: vi.fn(),
    quickAddTransaction: vi.fn(),
    quickReplaceTransaction: vi.fn(),
  },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

import { quickAddTransaction, quickReplaceTransaction } from "@/utils/api";

async function pick(triggerId: string, label: string) {
  const trigger = document.querySelector(`#${triggerId}`) as HTMLElement;
  await openSelect(trigger);
  clickOption(label);
}

const mockQuickAdd = quickAddTransaction as ReturnType<typeof vi.fn>;
const mockReplace = quickReplaceTransaction as ReturnType<typeof vi.fn>;

const ACCOUNTS = [
  { id: "acc-cash", name: "现金", account_type: "asset", is_active: true },
  { id: "acc-wechat", name: "微信", account_type: "asset", is_active: true },
  { id: "acc-old", name: "停用", account_type: "asset", is_active: false },
];

const CATEGORIES = [
  { id: "cat-food", name: "餐饮", type: "expense", icon: null },
  { id: "cat-salary", name: "工资", type: "income", icon: null },
];

beforeEach(() => {
  api.accountList.mockReset();
  api.categoryList.mockReset();
  mockQuickAdd.mockReset();
  mockReplace.mockReset();
  api.accountList.mockResolvedValue(ACCOUNTS);
  api.categoryList.mockResolvedValue(CATEGORIES);
  mockQuickAdd.mockResolvedValue({ id: "tx-1" });
  mockReplace.mockResolvedValue({ id: "tx-2" });
});

describe("QuickAddDialog review variant", () => {
  it("prefills from the proposal and submits with categoryName", async () => {
    const onOpenChange = vi.fn();

    renderWithProviders(
      <QuickAddDialog
        open={true}
        variant="review"
        onOpenChange={onOpenChange}
        initial={{
          mode: "expense",
          amount: "18.00",
          sourceAccountId: "acc-wechat",
          sourceAccountName: "WeChat",
          categoryName: "咖啡",
          description: "下午咖啡",
          date: "2026-11-14",
          warnings: ["分类「咖啡」是新建的"],
        }}
      />,
    );

    // Review title, not the blank-create title.
    expect(screen.getByText("修改这一笔")).toBeInTheDocument();

    // The reset effects must NOT wipe the prefill (design doc 11, P2-5).
    await waitFor(() => {
      const amount = screen.getByLabelText(/金额|Amount/) as HTMLInputElement;
      expect(amount.value).toBe("18.00");
    });
    const description = screen.getByLabelText(
      /备注|描述|Description/,
    ) as HTMLInputElement;
    expect(description.value).toBe("下午咖啡");

    // The proposed (not-yet-existing) category is visible as "new".
    expect(screen.getByText(/咖啡（新建）/)).toBeInTheDocument();

    // Submitting sends the proposed name via categoryName.
    fireEvent.click(screen.getByRole("button", { name: /保存|Save/i }));
    await waitFor(() => {
      expect(mockQuickAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "expense",
          amount: "18.00",
          sourceAccountId: "acc-wechat",
          categoryName: "咖啡",
        }),
      );
    });
  });

  it("upgrades a proposed category to the existing id once loaded", async () => {
    renderWithProviders(
      <QuickAddDialog
        open={true}
        variant="review"
        onOpenChange={vi.fn()}
        initial={{
          mode: "expense",
          amount: "18.00",
          sourceAccountId: "acc-wechat",
          categoryName: "餐饮",
          date: "2026-11-14",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/餐饮（新建）/)).not.toBeInTheDocument();
    });
  });

  it("starts blank in the create variant", async () => {
    renderWithProviders(<QuickAddDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("快速记账")).toBeInTheDocument();
    await waitFor(() => {
      const amount = screen.getByLabelText(/金额|Amount/) as HTMLInputElement;
      expect(amount.value).toBe("");
    });
  });
});

describe("QuickAddDialog create variant", () => {
  async function pick(triggerId: string, label: string) {
    const trigger = document.querySelector(`#${triggerId}`) as HTMLElement;
    await openSelect(trigger);
    clickOption(label);
  }

  it("records an expense", async () => {
    const onSuccess = vi.fn();
    renderWithProviders(
      <QuickAddDialog open onOpenChange={vi.fn()} onSuccess={onSuccess} />,
    );
    await screen.findByText("快速记账");

    fireEvent.change(
      document.querySelector("#quick-add-amount") as HTMLInputElement,
      { target: { value: "25.50" } },
    );
    await pick("source-account", "现金");
    await pick("expense-category", "餐饮");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mockQuickAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "expense",
          amount: "25.50",
          sourceAccountId: "acc-cash",
          categoryId: "cat-food",
        }),
      ),
    );
    expect(onSuccess).toHaveBeenCalledWith({ id: "tx-1" });
  });

  it("records an income", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    fireEvent.click(screen.getByRole("button", { name: "收入" }));
    fireEvent.change(
      document.querySelector("#quick-add-amount") as HTMLInputElement,
      { target: { value: "800" } },
    );
    await pick("destination-account", "微信");
    await pick("income-category", "工资");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mockQuickAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "income",
          amount: "800.00",
          destinationAccountId: "acc-wechat",
          categoryId: "cat-salary",
        }),
      ),
    );
  });

  it("moves money between two accounts", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    fireEvent.click(screen.getByRole("button", { name: "转账" }));
    fireEvent.change(
      document.querySelector("#quick-add-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    await pick("transfer-source", "现金");
    await pick("transfer-destination", "微信");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mockQuickAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "transfer",
          sourceAccountId: "acc-cash",
          destinationAccountId: "acc-wechat",
        }),
      ),
    );
  });

  it("refuses a transfer to the same account", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    fireEvent.click(screen.getByRole("button", { name: "转账" }));
    await pick("transfer-destination", "微信");
    await pick("transfer-source", "微信");

    expect(screen.getByText("来源和目标账户必须不同")).toBeInTheDocument();
  });

  it("keeps the save button shut until the form is complete", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();

    fireEvent.change(
      document.querySelector("#quick-add-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );
    expect(save).toBeDisabled();

    await pick("source-account", "现金");
    expect(save).toBeEnabled();
  });

  it("explains what the mode does", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    expect(screen.queryByText("从资产账户支出到支出分类")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /点击切换记账模式/ }));

    expect(screen.getByText("从资产账户支出到支出分类")).toBeInTheDocument();
  });

  it("reports a transaction it cannot write", async () => {
    mockQuickAdd.mockRejectedValue(new Error("写入失败"));
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    fireEvent.change(
      document.querySelector("#quick-add-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );
    await pick("source-account", "现金");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("写入失败")).toBeInTheDocument();
  });

  it("replaces the transaction it was asked to replace", async () => {
    renderWithProviders(
      <QuickAddDialog
        open
        onOpenChange={vi.fn()}
        variant="review"
        replaceId="tx-old"
        initial={{
          mode: "expense",
          amount: "18.00",
          sourceAccountId: "acc-wechat",
          sourceAccountName: "微信",
          date: "2026-11-14",
        }}
      />,
    );

    expect(
      screen.getByText("保存会删除原记录，且无法恢复"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存并覆盖" }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        "tx-old",
        expect.objectContaining({ amount: "18.00" }),
      ),
    );
    expect(mockQuickAdd).not.toHaveBeenCalled();
  });

  it("starts from what the reader typed before", async () => {
    renderWithProviders(
      <QuickAddDialog
        open
        onOpenChange={vi.fn()}
        prefill={{ description: "楼下面馆", amount: "18.5" }}
      />,
    );

    await waitFor(() => {
      const amount = document.querySelector(
        "#quick-add-amount",
      ) as HTMLInputElement;
      expect(amount.value).toBe("18.5");
    });
    const description = document.querySelector(
      "#quick-add-description",
    ) as HTMLInputElement;
    expect(description.value).toBe("楼下面馆");
  });
});

describe("QuickAddDialog modes", () => {
  it("explains what an income is", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    fireEvent.click(screen.getByRole("button", { name: "收入" }));
    fireEvent.click(screen.getByRole("button", { name: /点击切换记账模式/ }));

    expect(screen.getByText("从收入分类收入到资产账户")).toBeInTheDocument();
  });

  it("explains what a transfer is", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    fireEvent.click(screen.getByRole("button", { name: "转账" }));
    fireEvent.click(screen.getByRole("button", { name: /点击切换记账模式/ }));

    expect(
      screen.getByText("在两个资产或负债账户之间转移资金"),
    ).toBeInTheDocument();
  });

  it("stays where it is when the mode does not change", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    fireEvent.click(screen.getByRole("button", { name: "支出" }));

    expect(screen.getByText("记录一笔支出")).toBeInTheDocument();
  });

  it("shows nothing when it is closed", () => {
    renderWithProviders(<QuickAddDialog open={false} onOpenChange={vi.fn()} />);

    expect(screen.queryByText("快速记账")).toBeNull();
  });

  it("drops the proposed category once a real one is picked", async () => {
    renderWithProviders(
      <QuickAddDialog
        open
        variant="review"
        onOpenChange={vi.fn()}
        initial={{
          mode: "expense",
          amount: "18.00",
          sourceAccountId: "acc-cash",
          categoryName: "咖啡",
          date: "2026-11-14",
        }}
      />,
    );

    await screen.findByText(/咖啡（新建）/);
    await pick("expense-category", "餐饮");

    await waitFor(() => expect(screen.queryByText(/咖啡（新建）/)).toBeNull());
  });

  it("shows the icon of the category", async () => {
    api.categoryList.mockResolvedValue([
      { id: "cat-food", name: "餐饮", type: "expense", icon: "🍚" },
    ]);
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    await pick("expense-category", "🍚 餐饮");

    expect(screen.getAllByText("🍚 餐饮").length).toBeGreaterThan(0);
  });
});

describe("QuickAddDialog review variant", () => {
  it("fills the form from a proposal that says little", async () => {
    renderWithProviders(
      <QuickAddDialog
        open
        variant="review"
        onOpenChange={vi.fn()}
        initial={{
          mode: "expense",
          amount: "",
          date: "2026-11-14",
        }}
      />,
    );

    await screen.findByText("修改这一笔");
    const amount = document.querySelector(
      "#quick-add-amount",
    ) as HTMLInputElement;
    expect(amount.value).toBe("");
  });

  it("falls back to today when the proposal has no date", async () => {
    renderWithProviders(
      <QuickAddDialog
        open
        variant="review"
        onOpenChange={vi.fn()}
        initial={{
          mode: "expense",
          amount: "10.00",
          date: "",
        }}
      />,
    );

    await screen.findByText("修改这一笔");
    const amount = document.querySelector(
      "#quick-add-amount",
    ) as HTMLInputElement;
    expect(amount.value).toBe("10.00");
  });

  it("keeps the proposed category for an income", async () => {
    renderWithProviders(
      <QuickAddDialog
        open
        variant="review"
        onOpenChange={vi.fn()}
        initial={{
          mode: "income",
          amount: "8000.00",
          categoryName: "工资",
          date: "2026-11-14",
        }}
      />,
    );

    expect(await screen.findByText(/工资（新建）/)).toBeInTheDocument();
  });

  it("keeps the proposed category when it is picked again", async () => {
    renderWithProviders(
      <QuickAddDialog
        open
        variant="review"
        onOpenChange={vi.fn()}
        initial={{
          mode: "expense",
          amount: "18.00",
          sourceAccountId: "acc-cash",
          categoryName: "咖啡",
          date: "2026-11-14",
        }}
      />,
    );

    await screen.findByText(/咖啡（新建）/);
    await pick("expense-category", "咖啡（新建）");

    expect(screen.getByText(/咖啡（新建）/)).toBeInTheDocument();
  });
});

describe("QuickAddDialog modes", () => {
  it("switches back to an expense", async () => {
    renderWithProviders(<QuickAddDialog open onOpenChange={vi.fn()} />);
    await screen.findByText("快速记账");

    fireEvent.click(screen.getByRole("button", { name: "收入" }));
    fireEvent.click(screen.getByRole("button", { name: "支出" }));

    expect(screen.getByText("记录一笔支出")).toBeInTheDocument();
  });

  it("keeps what the reader typed when the dialog re-renders", async () => {
    function Wrapper() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((value) => value + 1)}>重绘</button>
          <QuickAddDialog
            open
            onOpenChange={vi.fn()}
            prefill={{ description: `第 ${tick} 次` }}
          />
        </>
      );
    }

    renderWithProviders(<Wrapper />);
    const description = await screen.findByPlaceholderText("例如：午餐");
    fireEvent.change(description, { target: { value: "楼下面馆" } });

    fireEvent.click(screen.getByText("重绘"));

    expect(
      (document.querySelector("#quick-add-description") as HTMLInputElement)
        .value,
    ).toBe("楼下面馆");
  });
});
