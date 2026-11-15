import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  AccountFields,
  type AccountFieldValues,
} from "@/components/accounts/AccountFields";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: { accountMetaSchema: vi.fn() },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const SCHEMA = {
  valid_account_roles: ["defaultAsset", "ccAsset"],
  valid_liability_types: ["loan", "mortgage"],
};

function values(
  overrides: Partial<AccountFieldValues> = {},
): AccountFieldValues {
  return {
    name: "",
    description: "",
    account_number: "",
    iban: "",
    is_active: true,
    include_net_worth: true,
    meta: {},
    ...overrides,
  };
}

function renderFields(
  props: Partial<React.ComponentProps<typeof AccountFields>> = {},
) {
  const onChange = vi.fn();
  const view = renderWithProviders(
    <AccountFields
      mode="create"
      accountType="asset"
      values={values()}
      onChange={onChange}
      {...props}
    />,
  );
  return { ...view, onChange };
}

describe("AccountFields", () => {
  beforeEach(() => {
    api.accountMetaSchema.mockReset();
    api.accountMetaSchema.mockResolvedValue(SCHEMA);
  });

  it("shows the fields every account has", () => {
    renderFields();

    expect(screen.getByLabelText("账户名称")).toBeInTheDocument();
    expect(screen.getByLabelText("备注")).toBeInTheDocument();
    expect(screen.getByLabelText("账户号")).toBeInTheDocument();
    expect(screen.getByLabelText("IBAN")).toBeInTheDocument();
  });

  it("hands every change to the parent", () => {
    const { onChange } = renderFields();

    fireEvent.change(screen.getByLabelText("账户名称"), {
      target: { value: "现金" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "现金" }),
    );

    fireEvent.change(screen.getByLabelText("备注"), {
      target: { value: "钱包" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ description: "钱包" }),
    );

    fireEvent.change(screen.getByLabelText("账户号"), {
      target: { value: "6222" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ account_number: "6222" }),
    );

    fireEvent.change(screen.getByLabelText("IBAN"), {
      target: { value: "DE00" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ iban: "DE00" }),
    );
  });

  it("shows the error of a field", () => {
    renderFields({ errors: { name: "名称不能为空" } });

    expect(screen.getByText("名称不能为空")).toBeInTheDocument();
  });

  it("offers the subtypes of an asset account", async () => {
    renderFields();

    await screen.findAllByRole("combobox");
    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    expect(screen.getByText("默认资产")).toBeInTheDocument();
    expect(screen.getByText("信用卡")).toBeInTheDocument();
  });

  it("offers the subtypes of a liability account", async () => {
    renderFields({ accountType: "liability" });

    await waitFor(() =>
      expect(screen.getAllByRole("combobox")).toHaveLength(2),
    );
    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    expect(screen.getByText("贷款")).toBeInTheDocument();
    expect(screen.getByText("按揭")).toBeInTheDocument();
  });

  it("hides the subtypes of an account that has none", () => {
    renderFields({ accountType: "income" });

    expect(screen.queryByText("默认资产")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows the credit card fields once the subtype is one", async () => {
    const { onChange } = renderFields({
      values: values({ meta: { account_role: "ccAsset" } }),
    });

    expect(screen.getByText("信用卡类型")).toBeInTheDocument();
    expect(screen.getAllByText("每月还款日").length).toBeGreaterThan(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the interest fields of a liability account", async () => {
    renderFields({ accountType: "liability" });

    await screen.findAllByRole("combobox");
    expect(screen.getByLabelText("利率")).toBeInTheDocument();
    expect(screen.getByText("利息周期")).toBeInTheDocument();
  });

  it("toggles the active flag", () => {
    const { onChange } = renderFields();

    fireEvent.click(screen.getByLabelText("账户激活"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false }),
    );
  });

  it("toggles the net worth flag", () => {
    const { onChange } = renderFields();

    fireEvent.click(screen.getByLabelText("计入净资产"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ include_net_worth: false }),
    );
  });

  it("leaves the net worth flag to the asset and liability accounts", () => {
    renderFields({ accountType: "income" });

    expect(screen.queryByLabelText("计入净资产")).toBeNull();
  });

  it("picks a subtype", async () => {
    const { onChange } = renderFields();

    await screen.findAllByRole("combobox");
    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("默认资产");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ account_role: "defaultAsset" }),
      }),
    );
  });

  it("clears the subtype again", async () => {
    const { onChange } = renderFields({
      values: values({ meta: { account_role: "defaultAsset" } }),
    });

    await screen.findAllByRole("combobox");
    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("—");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ account_role: "" }),
      }),
    );
  });

  it("reads the legacy subtype key of a liability account", async () => {
    renderFields({
      accountType: "liability",
      values: values({ meta: { account_role: "loan" } }),
    });

    await waitFor(() =>
      expect(screen.getAllByRole("combobox")).toHaveLength(2),
    );
    expect(screen.getByText("贷款")).toBeInTheDocument();
  });
});
