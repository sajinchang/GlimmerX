import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: {
    accountList: vi.fn(),
    accountBalance: vi.fn(),
    accountDelete: vi.fn(),
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

// The dialogs have their own tests; here they only have to say they opened.
vi.mock("@/components/accounts/AccountForm", () => ({
  AccountForm: ({ open }: { open: boolean }) =>
    open ? <div data-testid="account-form" /> : null,
}));
vi.mock("@/components/accounts/AccountWizard", () => ({
  AccountWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="account-wizard" /> : null,
}));
vi.mock("@/components/accounts/AccountTransactions", () => ({
  AccountTransactions: ({ open }: { open: boolean }) =>
    open ? <div data-testid="account-transactions" /> : null,
}));
vi.mock("@/components/accounts/ReconcileDialog", () => ({
  ReconcileDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="reconcile-dialog" /> : null,
}));

import { AccountsPage } from "@/pages/AccountsPage";
import { toast } from "sonner";
import type { AccountDto } from "@/types";

function account(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: "acc1",
    name: "现金",
    account_type: "asset",
    description: "",
    account_number: null,
    is_system: false,
    iban: null,
    is_active: true,
    include_net_worth: true,
    created_at: "2026-01-01T00:00:00+08:00",
    updated_at: "2026-01-01T00:00:00+08:00",
    meta: [],
    ...overrides,
  };
}

const ACCOUNTS = [
  account(),
  account({
    id: "acc2",
    name: "花呗",
    account_type: "liability",
    meta: [
      {
        id: "m1",
        account_id: "acc2",
        key: "account_role",
        value: "ccAsset",
        created_at: "2026-01-01T00:00:00+08:00",
      },
    ],
  }),
];

describe("AccountsPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.accountList.mockResolvedValue(ACCOUNTS);
    api.accountBalance.mockResolvedValue(50000);
    api.accountDelete.mockResolvedValue(undefined);
  });

  it("asks the ledger for the balance sheet accounts", async () => {
    renderWithProviders(<AccountsPage />);

    await waitFor(() =>
      expect(api.accountList).toHaveBeenCalledWith(["asset", "liability"]),
    );
  });

  it("says so when there is no account yet", async () => {
    api.accountList.mockResolvedValue([]);
    renderWithProviders(<AccountsPage />);

    expect(await screen.findByText("开始设置您的账户")).toBeInTheDocument();
  });

  it("lists the accounts with their balance", async () => {
    renderWithProviders(<AccountsPage />);

    expect(await screen.findByText("现金")).toBeInTheDocument();
    expect(screen.getByText("花呗")).toBeInTheDocument();
    expect(await screen.findByText("¥500.00")).toBeInTheDocument();
    // The subtype badge comes from the account metadata.
    expect(screen.getByText("花呗")).toBeInTheDocument();
  });

  it("keeps the accounts apart by type", async () => {
    renderWithProviders(<AccountsPage />);
    await screen.findByText("现金");

    // Radix switches a tab on a mouse press, not on a bare click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "负债" }));

    expect(screen.queryByText("现金")).toBeNull();
    expect(screen.getByText("花呗")).toBeInTheDocument();
  });

  it("finds an account by name", async () => {
    renderWithProviders(<AccountsPage />, { withHeaderActions: true });
    await screen.findByText("现金");

    const search = within(
      screen.getByTestId("header-actions"),
    ).getByPlaceholderText("搜索账户...");
    fireEvent.change(search, { target: { value: "花" } });

    expect(screen.queryByText("现金")).toBeNull();
    expect(screen.getByText("花呗")).toBeInTheDocument();
  });

  it("opens the wizard from the header", async () => {
    renderWithProviders(<AccountsPage />, { withHeaderActions: true });
    await screen.findByText("现金");

    const header = screen.getByTestId("header-actions");
    fireEvent.click(within(header).getByText("新建账户"));

    expect(screen.getByTestId("account-wizard")).toBeInTheDocument();
  });

  it("opens the form to edit an account", async () => {
    renderWithProviders(<AccountsPage />);
    await screen.findByText("现金");

    const row = screen.getByText("现金").closest("div.group");
    const buttons = row?.querySelectorAll("button") ?? [];
    fireEvent.click(buttons[1] as HTMLElement);

    expect(screen.getByTestId("account-form")).toBeInTheDocument();
  });

  it("deletes an account", async () => {
    renderWithProviders(<AccountsPage />);
    await screen.findByText("现金");

    const row = screen.getByText("现金").closest("div.group");
    const buttons = row?.querySelectorAll("button") ?? [];
    fireEvent.click(buttons[2] as HTMLElement);

    expect(await screen.findByText("确认删除账户")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(api.accountDelete).toHaveBeenCalledWith("acc1"));
    expect(toast.success).toHaveBeenCalledWith("账户已删除");
  });

  it("reports a failed deletion", async () => {
    api.accountDelete.mockRejectedValue(new Error("删除失败"));
    renderWithProviders(<AccountsPage />);
    await screen.findByText("现金");

    const row = screen.getByText("现金").closest("div.group");
    const buttons = row?.querySelectorAll("button") ?? [];
    fireEvent.click(buttons[2] as HTMLElement);
    await screen.findByText("确认删除账户");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("删除失败"));
  });

  it("opens the reconciliation of an account", async () => {
    renderWithProviders(<AccountsPage />);
    await screen.findByText("现金");

    const row = screen.getByText("现金").closest("div.group");
    const buttons = row?.querySelectorAll("button") ?? [];
    fireEvent.click(buttons[0] as HTMLElement);

    expect(screen.getByTestId("reconcile-dialog")).toBeInTheDocument();
  });

  it("opens the transactions of an account", async () => {
    renderWithProviders(<AccountsPage />);
    await screen.findByText("现金");

    fireEvent.click(screen.getByText("现金"));

    expect(screen.getByTestId("account-transactions")).toBeInTheDocument();
  });

  it("shows the number of the account and its subtype", async () => {
    api.accountList.mockResolvedValue([
      {
        ...ACCOUNTS[0],
        account_number: "6222",
        meta: [
          {
            id: "m1",
            account_id: "acc1",
            key: "account_role",
            value: "defaultAsset",
            created_at: "2026-01-01T00:00:00+08:00",
          },
        ],
      },
    ]);
    renderWithProviders(<AccountsPage />);

    expect(await screen.findByText("6222")).toBeInTheDocument();
    expect(screen.getByText("默认资产")).toBeInTheDocument();
  });

  it("keeps the account when the deletion is called off", async () => {
    renderWithProviders(<AccountsPage />);
    await screen.findByText("现金");

    const row = screen.getByText("现金").closest("div.group");
    const buttons = row?.querySelectorAll("button") ?? [];
    fireEvent.click(buttons[2] as HTMLElement);
    await screen.findByText("确认删除账户");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByText("确认删除账户")).toBeNull());
    expect(api.accountDelete).not.toHaveBeenCalled();
  });

  it("says that a liability is settled", async () => {
    api.accountList.mockResolvedValue([
      {
        ...ACCOUNTS[0],
        id: "acc2",
        name: "花呗",
        account_type: "liability",
      },
    ]);
    api.accountBalance.mockResolvedValue(0);
    renderWithProviders(<AccountsPage />);

    expect(await screen.findByText("已还清")).toBeInTheDocument();
  });
});
