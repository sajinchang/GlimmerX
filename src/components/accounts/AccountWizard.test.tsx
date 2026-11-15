import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AccountWizard } from "@/components/accounts/AccountWizard";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: { accountCreate: vi.fn(), accountMetaSchema: vi.fn() },
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

function renderWizard(props: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  renderWithProviders(
    <AccountWizard
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      {...props}
    />,
  );
  return { onOpenChange, onSuccess };
}

function fillName(name: string) {
  fireEvent.change(
    document.querySelector("#acc-fields-name") as HTMLInputElement,
    { target: { value: name } },
  );
}

describe("AccountWizard", () => {
  beforeEach(() => {
    api.accountCreate.mockReset();
    api.accountCreate.mockResolvedValue({ id: "acc-new" });
    api.accountMetaSchema.mockResolvedValue({
      valid_account_roles: ["defaultAsset", "ccAsset"],
      valid_liability_types: ["loan", "mortgage"],
    });
  });

  it("asks for the type of account first", async () => {
    renderWizard();

    expect(await screen.findByText("选择要创建的账户类型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("walks through the three steps", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    fillName("现金");
    fireEvent.change(
      document.querySelector("#acc-balance") as HTMLInputElement,
      { target: { value: "100.00" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(await screen.findByText("确认")).toBeInTheDocument();
    expect(screen.getByText("现金")).toBeInTheDocument();
    expect(screen.getByText("¥100")).toBeInTheDocument();
  });

  it("goes back a step", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fillName("现金");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByRole("button", { name: "添加" });

    fireEvent.click(screen.getByRole("button", { name: "上一步" }));

    expect(screen.queryByRole("button", { name: "添加" })).toBeNull();
  });

  it("writes the account", async () => {
    const { onOpenChange, onSuccess } = renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fillName("现金");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("确认");

    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() =>
      expect(api.accountCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "asset/现金" }),
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("账户创建成功");
    expect(onSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the wizard open so another account can be added", async () => {
    const { onOpenChange } = renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fillName("现金");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("确认");

    fireEvent.click(screen.getByRole("button", { name: "添加并继续" }));

    await waitFor(() => expect(api.accountCreate).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the next button shut until the account has a name", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    const next = screen.getByRole("button", { name: "下一步" });
    expect(next).toBeDisabled();

    fillName("现金");
    expect(next).toBeEnabled();
  });

  it("reports an account it could not write", async () => {
    api.accountCreate.mockRejectedValue(new Error("建不了"));
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fillName("现金");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("确认");

    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("建不了"));
  });

  it("starts at the second step when the type is already known", async () => {
    renderWizard({ initialType: "liability" });

    expect(screen.queryByRole("button", { name: "添加" })).toBeNull();
    expect(screen.getByText("账户名称")).toBeInTheDocument();
    // A liability shows what is owed instead of what is there.
    expect(screen.getAllByText(/负债/).length).toBeGreaterThan(0);
  });

  it("keeps what the reader filled in for the summary", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    fillName("现金");
    fireEvent.change(
      document.querySelector("#acc-fields-desc") as HTMLTextAreaElement,
      { target: { value: "钱包里的钱" } },
    );
    fireEvent.change(
      document.querySelector("#acc-fields-number") as HTMLInputElement,
      { target: { value: "6222" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(await screen.findByText("钱包里的钱")).toBeInTheDocument();
    expect(screen.getByText("6222")).toBeInTheDocument();
  });

  it("shows the subtype it holds", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fillName("现金");

    // The subtype picker offers the roles the backend knows.
    const subtype = await screen.findByRole("combobox");
    await openSelect(subtype);
    clickOption("默认资产");

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(await screen.findByText("默认资产")).toBeInTheDocument();
  });

  it("shows a liability without an initial balance", async () => {
    renderWizard({ initialType: "liability" });

    await screen.findByText("账户名称");
    fillName("花呗");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(
      await screen.findByRole("button", { name: "添加" }),
    ).toBeInTheDocument();
    expect(screen.getByText("¥0")).toBeInTheDocument();
  });

  it("sends no balance when the reader cleared the field", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /资产/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fillName("现金");
    fireEvent.change(
      document.querySelector("#acc-balance") as HTMLInputElement,
      { target: { value: "" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByRole("button", { name: "添加" });

    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() =>
      expect(api.accountCreate).toHaveBeenCalledWith(
        expect.objectContaining({ initial_balance: undefined }),
      ),
    );
  });

  it("starts over when it is closed", () => {
    renderWizard({ open: false });

    expect(screen.queryByText("新建账户")).toBeNull();
  });

  it("shows the kind of liability it is", async () => {
    renderWizard({ initialType: "liability" });

    await screen.findByText("账户名称");
    fillName("花呗");

    const subtypes = await screen.findAllByRole("combobox");
    await openSelect(subtypes[0] as HTMLElement);
    clickOption("贷款");

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(
      await screen.findByRole("button", { name: "添加" }),
    ).toBeInTheDocument();
    expect(screen.getByText("贷款")).toBeInTheDocument();
  });
});
