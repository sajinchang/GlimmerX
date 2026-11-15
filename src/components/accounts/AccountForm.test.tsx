import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AccountForm } from "@/components/accounts/AccountForm";
import { renderWithProviders } from "@/test-utils/render";
import type { AccountDto } from "@/types";

const { api } = vi.hoisted(() => ({
  api: {
    accountUpdate: vi.fn(),
    accountMetaSchema: vi.fn(),
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

import { toast } from "sonner";

const SCHEMA = {
  valid_account_roles: ["defaultAsset", "ccAsset"],
  valid_liability_types: ["loan", "mortgage"],
};

function account(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: "acc1",
    name: "现金",
    account_type: "asset",
    description: "钱包里的钱",
    account_number: "6222",
    is_system: false,
    iban: "CN00",
    is_active: true,
    include_net_worth: true,
    created_at: "2026-01-01T00:00:00+08:00",
    updated_at: "2026-01-01T00:00:00+08:00",
    meta: [],
    ...overrides,
  };
}

describe("AccountForm", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.accountUpdate.mockResolvedValue({});
    api.accountMetaSchema.mockResolvedValue(SCHEMA);
  });

  it("shows nothing when there is no account to edit", () => {
    const { container } = renderWithProviders(
      <AccountForm open onOpenChange={vi.fn()} onSuccess={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("fills the form from the account", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account()}
      />,
    );

    expect(await screen.findByText("编辑账户")).toBeInTheDocument();
    expect(
      (document.querySelector("#acc-fields-name") as HTMLInputElement).value,
    ).toBe("现金");
    expect(
      (document.querySelector("#acc-fields-desc") as HTMLTextAreaElement).value,
    ).toBe("钱包里的钱");
    expect(
      (document.querySelector("#acc-fields-number") as HTMLInputElement).value,
    ).toBe("6222");
  });

  it("shows the balance of an asset account", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account({
          initial_balance: 12345,
          initial_balance_date: "2026-01-02",
        })}
      />,
    );

    await screen.findByText("编辑账户");
    expect(
      (document.querySelector("#edit-initial-balance") as HTMLInputElement)
        .value,
    ).toBe("123.45");
  });

  it("shows what a liability is owed", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account({
          account_type: "liability",
          initial_balance: -7000,
        })}
      />,
    );

    await screen.findByText("编辑账户");
    expect(
      (document.querySelector("#edit-initial-balance") as HTMLInputElement)
        .value,
    ).toBe("70.00");
  });

  it("shows a zero balance as zero", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account({ initial_balance: 0 })}
      />,
    );

    await screen.findByText("编辑账户");
    expect(
      (document.querySelector("#edit-initial-balance") as HTMLInputElement)
        .value,
    ).toBe("0");
  });

  it("saves the changes", async () => {
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        editNode={account({
          initial_balance: 12345,
          meta: [
            {
              id: "m1",
              account_id: "acc1",
              key: "account_role",
              value: "defaultAsset",
              created_at: "2026-01-01T00:00:00+08:00",
            },
          ],
        })}
      />,
    );
    await screen.findByText("编辑账户");

    fireEvent.change(
      document.querySelector("#acc-fields-name") as HTMLInputElement,
      { target: { value: "现金钱包" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.accountUpdate).toHaveBeenCalledWith("acc1", {
        name: "现金钱包",
        description: "钱包里的钱",
        account_number: "6222",
        initial_balance: "123.45",
        initial_balance_date: expect.any(String),
        iban: "CN00",
        is_active: true,
        include_net_worth: true,
        meta: { account_role: "defaultAsset" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("账户更新成功");
    expect(onSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("leaves out what the reader did not fill in", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account({
          description: "",
          account_number: null,
          iban: null,
          initial_balance: 0,
        })}
      />,
    );
    await screen.findByText("编辑账户");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.accountUpdate).toHaveBeenCalledWith(
        "acc1",
        expect.objectContaining({
          description: undefined,
          account_number: undefined,
          iban: undefined,
          initial_balance: undefined,
          initial_balance_date: undefined,
          meta: undefined,
        }),
      ),
    );
  });

  it("reports a change it could not save", async () => {
    api.accountUpdate.mockRejectedValue(new Error("改不了"));
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account()}
      />,
    );
    await screen.findByText("编辑账户");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("改不了"));
  });

  it("closes without saving", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={onOpenChange}
        onSuccess={vi.fn()}
        editNode={account()}
      />,
    );
    await screen.findByText("编辑账户");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.accountUpdate).not.toHaveBeenCalled();
  });

  it("fills the blanks of an account that has nothing to show", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account({
          description: null as unknown as string,
          account_number: null,
          iban: null,
          is_active: null as unknown as boolean,
        })}
      />,
    );

    await screen.findByText("编辑账户");
    expect(
      (document.querySelector("#acc-fields-desc") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(
      (document.querySelector("#acc-fields-number") as HTMLInputElement).value,
    ).toBe("");
  });

  it("has no balance field for an account that cannot hold one", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account({ account_type: "income" })}
      />,
    );

    await screen.findByText("编辑账户");
    expect(document.querySelector("#edit-initial-balance")).toBeNull();
  });

  it("asks for a name", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account()}
      />,
    );
    await screen.findByText("编辑账户");

    fireEvent.change(
      document.querySelector("#acc-fields-name") as HTMLInputElement,
      { target: { value: "  " } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(toast.error).toHaveBeenCalledWith("名称不能为空");
    expect(api.accountUpdate).not.toHaveBeenCalled();
  });

  it("leaves out the metadata that is empty", async () => {
    renderWithProviders(
      <AccountForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        editNode={account({
          meta: [
            {
              id: "m1",
              account_id: "acc1",
              key: "account_role",
              value: "",
              created_at: "2026-01-01T00:00:00+08:00",
            },
          ],
        })}
      />,
    );
    await screen.findByText("编辑账户");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.accountUpdate).toHaveBeenCalledWith(
        "acc1",
        expect.objectContaining({ meta: undefined }),
      ),
    );
  });
});
