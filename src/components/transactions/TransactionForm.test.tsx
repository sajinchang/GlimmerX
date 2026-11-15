import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { clickOption, openSelect } from "@/test-utils/radix";
import type { AccountDto, Category } from "@/types";

const accounts: AccountDto[] = [
  {
    id: "acc-bank",
    name: "银行账户",
    account_type: "asset",
    description: "",
    account_number: null,
    is_system: false,
    iban: null,
    is_active: true,
    include_net_worth: true,
    created_at: "2026-11-01T00:00:00+08:00",
    updated_at: "2026-11-01T00:00:00+08:00",
    meta: [],
  },
  {
    id: "acc-food",
    name: "餐饮账户",
    account_type: "expense",
    description: "",
    account_number: null,
    is_system: false,
    iban: null,
    is_active: true,
    include_net_worth: false,
    created_at: "2026-11-01T00:00:00+08:00",
    updated_at: "2026-11-01T00:00:00+08:00",
    meta: [],
  },
];

const categories: Category[] = [
  {
    id: "cat-food",
    name: "餐饮",
    type: "expense",
    icon: null,
    accountId: "acc-food",
    balance: 0,
    createdAt: "2026-11-01T00:00:00+08:00",
    updatedAt: "2026-11-01T00:00:00+08:00",
  },
];

function renderForm(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    mode: "create" as const,
    accounts,
    categories,
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<TransactionForm {...props} />);
  return props;
}

describe("TransactionForm", () => {
  it("opens with an empty, unbalanced draft", async () => {
    renderForm();

    expect(await screen.findByText("创建交易")).toBeInTheDocument();
    expect(screen.getByText("余额检查")).toBeInTheDocument();
    // An empty draft sums to zero, so the balance line reads balanced.
    expect(screen.getByText("平衡 ✓")).toBeInTheDocument();
  });

  it("keeps the submit button disabled until the postings balance", async () => {
    renderForm();

    const submit = await screen.findByRole("button", { name: "保存" });
    expect(submit).toBeDisabled();
  });

  it("explains the double-entry rules on demand", async () => {
    renderForm();

    expect(screen.queryByText("复式记账规则")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("复式记账说明"));

    expect(await screen.findByText("复式记账规则")).toBeInTheDocument();
    expect(
      screen.getByText("所有分录金额之和必须为 0（借贷平衡）"),
    ).toBeInTheDocument();
  });

  it("adds a posting row on request", async () => {
    renderForm();

    const add = await screen.findByRole("button", { name: "添加分录" });
    const before = screen.getAllByPlaceholderText("金额").length;
    fireEvent.click(add);

    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("金额").length).toBe(before + 1),
    );
  });

  it("warns about amounts with more than two decimals", async () => {
    renderForm();

    const amounts = await screen.findAllByPlaceholderText("金额");
    fireEvent.change(amounts[0] as HTMLElement, {
      target: { value: "12.345" },
    });

    expect(
      await screen.findByText("金额仅支持2位小数，多余精度将被四舍五入。"),
    ).toBeInTheDocument();
  });

  it("does not submit while the postings are unbalanced", async () => {
    const props = renderForm();

    const amounts = await screen.findAllByPlaceholderText("金额");
    fireEvent.change(amounts[0] as HTMLElement, {
      target: { value: "10.00" },
    });

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("fills the form from the transaction it edits", async () => {
    renderForm({
      mode: "edit",
      transaction: {
        id: "t1",
        date: "2026-11-05",
        description: "买菜",
        createdAt: "2026-11-05T10:00:00+08:00",
        updatedAt: "2026-11-05T10:00:00+08:00",
        postings: [
          {
            id: "p1",
            transactionId: "t1",
            accountId: "acc-bank",
            categoryId: null,
            categoryName: null,
            amount: 5000,
            sequence: 0,
            createdAt: "2026-11-05T10:00:00+08:00",
          },
          {
            id: "p2",
            transactionId: "t1",
            accountId: "acc-food",
            categoryId: "cat-food",
            categoryName: "餐饮",
            amount: -5000,
            sequence: 1,
            createdAt: "2026-11-05T10:00:00+08:00",
          },
        ],
      },
    });

    expect(await screen.findByText("编辑")).toBeInTheDocument();
    expect(
      (document.querySelector("#transaction-description") as HTMLInputElement)
        .value,
    ).toBe("买菜");
    const amounts = await screen.findAllByPlaceholderText("金额");
    expect(amounts[0]).toHaveValue(50);
    expect(amounts[1]).toHaveValue(-50);
  });

  it("takes a posting away when there is more than one to spare", async () => {
    renderForm();

    const add = await screen.findByRole("button", { name: "添加分录" });
    fireEvent.click(add);
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("金额").length).toBe(3),
    );

    const remove = screen.getAllByRole("button", { name: "移除" });
    fireEvent.click(remove[2] as HTMLElement);

    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("金额").length).toBe(2),
    );
    // A transaction always keeps two sides, so nothing can be taken away now.
    for (const button of screen.getAllByRole("button", { name: "移除" })) {
      expect(button).toBeDisabled();
    }
  });

  it("warns when the same account is used twice", async () => {
    renderForm();

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("银行账户");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("银行账户");

    expect(
      await screen.findByText("同一账户不能在同一交易中出现多次"),
    ).toBeInTheDocument();
  });

  it("names the category behind an account", async () => {
    renderForm();

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);

    expect(screen.getAllByText("餐饮").length).toBeGreaterThan(0);
  });

  it("says how much the postings differ by", async () => {
    renderForm();

    const amounts = await screen.findAllByPlaceholderText("金额");
    fireEvent.change(amounts[0] as HTMLElement, {
      target: { value: "10.00" },
    });

    expect(await screen.findByText("不平衡：差额 ¥10.00")).toBeInTheDocument();
  });

  it("warns about an amount that rounds to nothing", async () => {
    renderForm();

    const amounts = await screen.findAllByPlaceholderText("金额");
    fireEvent.change(amounts[0] as HTMLElement, {
      target: { value: "0.004" },
    });

    expect(
      await screen.findByText("金额太小。最小金额为 0.01。"),
    ).toBeInTheDocument();
  });

  it("sends a balanced transaction", async () => {
    const props = renderForm();

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("银行账户");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("餐饮");

    const amounts = await screen.findAllByPlaceholderText("金额");
    fireEvent.change(amounts[0] as HTMLElement, { target: { value: "50.00" } });
    fireEvent.change(amounts[1] as HTMLElement, {
      target: { value: "-50.00" },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(props.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          postings: [
            { accountId: "acc-bank", amount: "50.00" },
            { accountId: "acc-food", amount: "-50.00" },
          ],
        }),
      ),
    );
  });

  it("says that it is still saving", async () => {
    renderForm({ isLoading: true });

    expect(
      await screen.findByRole("button", { name: "处理中..." }),
    ).toBeDisabled();
  });

  it("keeps a transaction without a description readable", async () => {
    renderForm({
      mode: "edit",
      transaction: {
        id: "t1",
        date: "2026-11-05",
        description: "",
        createdAt: "2026-11-05T10:00:00+08:00",
        updatedAt: "2026-11-05T10:00:00+08:00",
        postings: [
          {
            id: "p1",
            transactionId: "t1",
            accountId: "acc-bank",
            categoryId: null,
            categoryName: null,
            amount: 5000,
            sequence: 0,
            createdAt: "2026-11-05T10:00:00+08:00",
          },
          {
            id: "p2",
            transactionId: "t1",
            accountId: "acc-food",
            categoryId: "cat-food",
            categoryName: "餐饮",
            amount: -5000,
            sequence: 1,
            createdAt: "2026-11-05T10:00:00+08:00",
          },
        ],
      },
    });

    await screen.findByText("编辑");
    expect(
      (document.querySelector("#transaction-description") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("shows the icon of the category behind an account", async () => {
    renderForm({
      categories: [{ ...categories[0], icon: "🍚" }],
    });

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);

    expect(screen.getAllByText("🍚 餐饮").length).toBeGreaterThan(0);
  });

  it("names the account when it stands for no category", async () => {
    renderForm({
      accounts: [
        ...accounts,
        {
          ...accounts[0],
          id: "acc-salary",
          name: "工资账户",
          account_type: "income",
        },
      ],
    });

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);

    expect(screen.getAllByText("工资账户").length).toBeGreaterThan(0);
  });
});
