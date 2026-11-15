import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { TransactionFilterPanel } from "@/components/transactions/TransactionFilterPanel";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";
import type { EnhancedTransactionFilter } from "@/types";

const ACCOUNTS = [
  { id: "a1", name: "现金" },
  { id: "a2", name: "银行卡" },
];

const CATEGORIES = [
  { id: "c1", name: "餐饮", icon: "🍚" },
  { id: "c2", name: "交通", icon: null },
];

function renderPanel(filter: EnhancedTransactionFilter = {}) {
  const onChange = vi.fn();
  const onClearFilter = vi.fn();
  const view = renderWithProviders(
    <TransactionFilterPanel
      filter={filter}
      accounts={ACCOUNTS as never}
      categories={CATEGORIES as never}
      onClearFilter={onClearFilter}
      onChange={onChange}
    />,
  );
  return { ...view, onChange, onClearFilter };
}

describe("TransactionFilterPanel", () => {
  it("shows the empty filters without a clear button", () => {
    renderPanel();

    expect(screen.getByText("日期")).toBeInTheDocument();
    expect(screen.getByText("金额")).toBeInTheDocument();
    expect(screen.getByText("账户")).toBeInTheDocument();
    expect(screen.getByText("分类")).toBeInTheDocument();
    expect(screen.queryByText("清除")).toBeNull();
  });

  it("offers a clear button once a filter is set", () => {
    const { onClearFilter } = renderPanel({ accountId: "a1" });

    fireEvent.click(screen.getByText("清除"));
    expect(onClearFilter).toHaveBeenCalled();
  });

  it("shows the amount bounds that are already set", () => {
    renderPanel({ minAmount: 1000, maxAmount: 200000 });

    expect(screen.getByPlaceholderText("最小")).toHaveValue(10);
    expect(screen.getByPlaceholderText("最大")).toHaveValue(2000);
  });

  it("turns a typed amount into cents", () => {
    const { onChange } = renderPanel();

    const min = screen.getByPlaceholderText("最小");
    fireEvent.change(min, { target: { value: "12.34" } });
    fireEvent.blur(min);

    expect(onChange).toHaveBeenCalledWith({ minAmount: 1234 });
  });

  it("clears an emptied amount", () => {
    const { onChange } = renderPanel({ minAmount: 1000 });

    const min = screen.getByPlaceholderText("最小");
    fireEvent.change(min, { target: { value: "" } });
    fireEvent.blur(min);

    expect(onChange).toHaveBeenCalledWith({ minAmount: undefined });
  });

  it("ignores a negative amount", () => {
    const { onChange } = renderPanel();

    const min = screen.getByPlaceholderText("最小");
    fireEvent.change(min, { target: { value: "-5" } });
    fireEvent.blur(min);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("sets the maximum amount as well", () => {
    const { onChange } = renderPanel();

    const max = screen.getByPlaceholderText("最大");
    fireEvent.change(max, { target: { value: "99.99" } });
    fireEvent.blur(max);

    expect(onChange).toHaveBeenCalledWith({ maxAmount: 9999 });
  });

  it("picks an account from the list", async () => {
    const { onChange } = renderPanel();

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("银行卡");

    expect(onChange).toHaveBeenCalledWith({ accountId: "a2" });
  });

  it("goes back to every account", async () => {
    const { onChange } = renderPanel({ accountId: "a2" });

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("全部");

    expect(onChange).toHaveBeenCalledWith({ accountId: undefined });
  });

  it("picks a category from the list", async () => {
    const { onChange } = renderPanel();

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("交通");

    expect(onChange).toHaveBeenCalledWith({ categoryId: "c2" });
  });
});
