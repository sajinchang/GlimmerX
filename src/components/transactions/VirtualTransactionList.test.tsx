import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { VirtualTransactionList } from "@/components/transactions/VirtualTransactionList";
import { renderWithProviders } from "@/test-utils/render";
import { triggerIntersection } from "@/test-utils/intersectionObserver";
import type { VirtualListItem } from "@/utils/virtualList";
import type { TransactionListItem } from "@/types";

/**
 * The virtualizer measures the scroll box, and jsdom has no layout: the
 * viewport is empty, so nothing would ever be rendered. The stub hands back
 * every item instead, which is what a reader with a screen would see.
 */
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: {
    count: number;
    estimateSize: (index: number) => number;
  }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: index,
        size: options.estimateSize(index),
        start: index * 64,
      })),
    getTotalSize: () => options.count * 64,
  }),
}));

const TRANSACTION: TransactionListItem = {
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
};

const ITEMS: VirtualListItem[] = [
  { type: "date-header", date: "2026-11-05", dayTotal: 5000, isFirst: true },
  { type: "transaction", data: TRANSACTION, date: "2026-11-05" },
];

describe("VirtualTransactionList", () => {
  it("renders the day header and the transaction", () => {
    renderWithProviders(
      <VirtualTransactionList
        items={ITEMS}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
      />,
    );

    expect(screen.getByText("买菜")).toBeInTheDocument();
    expect(screen.getByText(/当日合计/)).toBeInTheDocument();
  });

  it("says that more is on the way", () => {
    renderWithProviders(
      <VirtualTransactionList
        items={ITEMS}
        hasNextPage={false}
        isFetchingNextPage
        fetchNextPage={vi.fn()}
      />,
    );

    expect(screen.getByText("加载更多...")).toBeInTheDocument();
  });

  it("asks for the next page when the sentinel shows up", () => {
    const fetchNextPage = vi.fn();
    renderWithProviders(
      <VirtualTransactionList
        items={ITEMS}
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={fetchNextPage}
      />,
    );

    triggerIntersection(true);

    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("does not ask for the next page while it is already fetching", () => {
    const fetchNextPage = vi.fn();
    renderWithProviders(
      <VirtualTransactionList
        items={ITEMS}
        hasNextPage
        isFetchingNextPage
        fetchNextPage={fetchNextPage}
      />,
    );

    triggerIntersection(true);

    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("renders nothing when there is nothing to show", () => {
    renderWithProviders(
      <VirtualTransactionList
        items={[]}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
      />,
    );

    expect(screen.queryByText("买菜")).toBeNull();
  });

  it("gives a day header a row of its own", () => {
    const { container } = renderWithProviders(
      <VirtualTransactionList
        items={ITEMS}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
      />,
    );

    const rows = container.querySelectorAll('div[style*="translateY"]');
    expect(rows[0]).toHaveStyle({ height: "44px" });
    expect(rows[1]).toHaveStyle({ height: "64px" });
  });
});
