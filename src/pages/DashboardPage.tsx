import {
  DashboardStatusBar,
  AttentionBar,
  MonthlyIncomeExpenseChart,
  CategoryBreakdownChart,
  TopExpensesList,
  RecentTransactionsCard,
  AccountBalanceList,
  BudgetOverviewCard,
} from "@/components/dashboard";

/**
 * A dashboard, not a column of cards.
 *
 * The page used to stack eight sections vertically — four summary cards, three
 * health cards, then five more panels — which meant two and a half screens of
 * scrolling for what one screen could show. It now reads in four layers: one
 * net-worth figure with the 90-day activity calendar, a "needs my attention"
 * row, then the three columns of trends and detail. Every panel here is
 * `elevation="raise"`: one panel with an inverted bevel reads as a broken
 * border next to its neighbours, not as a different depth. The `well`
 * surface still exists for a genuine recessed display, but a dashboard of
 * peers is not the place to introduce it.
 *
 * Columns are sized by content weight rather than equally (`1.2fr / 1fr /
 * 0.9fr`): a time axis needs horizontal room, the table needs room for four
 * columns, and the side panels are lists that read fine narrow.
 *
 * From `lg` up the grid fills the viewport instead of growing with its
 * content, and each pane scrolls internally. That is what keeps the three
 * columns ending on the same line: card heights used to be decided by content,
 * so a column with two charts was 200 px taller than a column with one table
 * and the page looked unfinished. `h-full` is what makes the column heights
 * definite, and it has to stay on the page root — `min-h-full` would let the
 * columns collapse back to their content.
 *
 * Below `lg` the viewport-filling layout must not apply. Every wrapper there
 * carries `min-h-0`, which makes each grid track's minimum contribution zero,
 * so the tracks split the viewport height evenly while the cards keep their
 * own minimum heights — six panes sharing one compressed column overflowed
 * their tracks and painted over the rows below. Small screens get natural
 * document flow instead: the grid grows, the page scrolls.
 *
 * The greeting is gone on purpose. The header already says which page this is;
 * a second heading saying "welcome" above four numbers only delays them.
 */
export function DashboardPage() {
  return (
    <div className="flex min-h-full flex-col gap-3 lg:h-full lg:min-h-0">
      <DashboardStatusBar />
      <AttentionBar />

      <div
        data-print="panes"
        className="grid gap-3 lg:min-h-0 lg:flex-1 lg:overflow-auto lg:grid-cols-2 xl:grid-cols-[1.2fr_1fr_0.9fr]"
      >
        <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
          <MonthlyIncomeExpenseChart />
          <CategoryBreakdownChart />
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
          <RecentTransactionsCard />
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
          <BudgetOverviewCard />
          <AccountBalanceList />
          <TopExpensesList />
        </div>
      </div>
    </div>
  );
}
