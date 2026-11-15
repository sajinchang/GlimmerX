import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { TransactionCard } from "@/components/transactions/TransactionCard";
import { renderWithProviders } from "@/test-utils/render";
import type { TransactionListItem } from "@/types";

function transaction(
  overrides: Partial<TransactionListItem> = {},
): TransactionListItem {
  return {
    id: "t1",
    date: "2026-11-05",
    description: "买菜",
    categoryNames: ["餐饮"],
    categoryIcon: "🍚",
    postingsSummary: [],
    displayAmount: 5000,
    flowAmount: -5000,
    createdAt: "2026-11-05T10:00:00+08:00",
    updatedAt: "2026-11-05T10:00:00+08:00",
    ...overrides,
  };
}

describe("TransactionCard", () => {
  it("shows the transaction", () => {
    renderWithProviders(<TransactionCard transaction={transaction()} />);

    expect(screen.getByText("买菜")).toBeInTheDocument();
    expect(screen.getByText("¥50.00")).toBeInTheDocument();
    expect(screen.getByText("🍚 餐饮")).toBeInTheDocument();
  });

  it("names the accounts a split transaction touched", () => {
    renderWithProviders(
      <TransactionCard
        transaction={transaction({
          postingsSummary: [
            { accountName: "餐饮", amount: -5000 },
            { accountName: "现金", amount: 5000 },
          ],
        })}
      />,
    );

    expect(screen.getByText("餐饮 -¥50.00")).toBeInTheDocument();
    expect(screen.getByText("现金 ¥50.00")).toBeInTheDocument();
  });

  it("counts the categories of a split transaction", () => {
    renderWithProviders(
      <TransactionCard
        transaction={transaction({
          categoryNames: ["餐饮", "交通", "购物"],
          categoryIcon: null,
        })}
      />,
    );

    expect(screen.getByText("餐饮、交通 等 1 项")).toBeInTheDocument();
  });

  it("keeps the transaction without a description readable", () => {
    renderWithProviders(
      <TransactionCard transaction={transaction({ description: "" })} />,
    );

    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("hides the category of a transaction without one", () => {
    renderWithProviders(
      <TransactionCard
        transaction={transaction({ categoryNames: [], categoryIcon: null })}
      />,
    );

    expect(screen.queryByText("🍚 餐饮")).toBeNull();
  });

  it("opens the transaction when it is pressed", () => {
    renderWithProviders(<TransactionCard transaction={transaction()} />);

    fireEvent.click(screen.getByText("买菜"));

    // The card navigates to the detail page.
    expect(screen.getByText("买菜")).toBeInTheDocument();
  });

  it("shows the edit and delete actions while the pointer is over it", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderWithProviders(
      <TransactionCard
        transaction={transaction()}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();

    fireEvent.mouseEnter(screen.getByText("买菜"));
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0] as HTMLElement);
    expect(onEdit).toHaveBeenCalled();

    fireEvent.click(buttons[1] as HTMLElement);
    expect(onDelete).toHaveBeenCalled();
  });

  it("hides the actions again when the pointer leaves", () => {
    renderWithProviders(
      <TransactionCard transaction={transaction()} onEdit={vi.fn()} />,
    );

    fireEvent.mouseEnter(screen.getByText("买菜"));
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.mouseLeave(screen.getByText("买菜"));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
