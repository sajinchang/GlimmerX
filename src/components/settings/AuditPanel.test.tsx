import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AuditPanel } from "@/components/settings/AuditPanel";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: { reportAudit: vi.fn() },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const HEALTHY = {
  balanceCheck: {
    totalTransactions: 10,
    balancedCount: 10,
    unbalancedCount: 0,
    unbalancedTransactions: [],
  },
  categoryCheck: {
    uncategorizedTransactions: 0,
    uncategorizedList: [],
  },
  accountUsage: [],
  generatedAt: "2026-11-15T10:00:00+08:00",
};

const BROKEN = {
  balanceCheck: {
    totalTransactions: 10,
    balancedCount: 8,
    unbalancedCount: 2,
    unbalancedTransactions: [
      {
        transactionId: "t1",
        date: "2026-11-01",
        description: "买菜",
        sum: 5000,
      },
      {
        transactionId: "t2",
        date: "2026-11-02",
        description: "打车",
        sum: -2000,
      },
    ],
  },
  categoryCheck: {
    uncategorizedTransactions: 1,
    uncategorizedList: [
      { transactionId: "t3", date: "2026-11-03", description: "超市" },
    ],
  },
  accountUsage: [
    {
      accountId: "acc1",
      accountName: "现金",
      accountType: "asset",
      postingCount: 4,
      totalDebit: 5000,
      totalCredit: 2000,
      lastTransactionDate: "2026-11-04",
    },
    {
      accountId: "acc2",
      accountName: "工资",
      accountType: "income",
      postingCount: 1,
      totalDebit: 0,
      totalCredit: 1000,
    },
  ],
  generatedAt: "2026-11-15T10:00:00+08:00",
};

describe("AuditPanel", () => {
  beforeEach(() => {
    api.reportAudit.mockReset();
    api.reportAudit.mockResolvedValue(HEALTHY);
  });

  it("says so when the ledger is healthy", async () => {
    renderWithProviders(<AuditPanel />);

    expect(
      await screen.findByText("每条交易的分录金额合计为零"),
    ).toBeInTheDocument();
    expect(screen.getByText("所有分录都归到分类")).toBeInTheDocument();
    expect(screen.getByText("暂无账户使用数据")).toBeInTheDocument();
    expect(screen.getAllByText("10").length).toBeGreaterThan(0);
  });

  it("lists the transactions that do not add up", async () => {
    api.reportAudit.mockResolvedValue(BROKEN);
    renderWithProviders(<AuditPanel />);

    expect(await screen.findByText("展开详情")).toBeInTheDocument();
    fireEvent.click(screen.getByText("展开详情"));

    expect(screen.getByText("买菜")).toBeInTheDocument();
    expect(screen.getAllByText("¥50.00").length).toBeGreaterThan(0);
    expect(screen.getByText("-¥20.00")).toBeInTheDocument();

    fireEvent.click(screen.getByText("收起详情"));
    expect(screen.queryByText("买菜")).toBeNull();
  });

  it("lists the transactions without a category", async () => {
    api.reportAudit.mockResolvedValue(BROKEN);
    renderWithProviders(<AuditPanel />);

    fireEvent.click(await screen.findByText("展开未分类"));

    expect(screen.getByText("超市")).toBeInTheDocument();
  });

  it("shows how much each account was used", async () => {
    api.reportAudit.mockResolvedValue(BROKEN);
    renderWithProviders(<AuditPanel />);

    expect(await screen.findByText("现金")).toBeInTheDocument();
    expect(screen.getByText("工资")).toBeInTheDocument();
    expect(screen.getByText("2026-11-04")).toBeInTheDocument();
    // An account that was never used has no date.
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("reports an audit it cannot run", async () => {
    api.reportAudit.mockRejectedValue(new Error("审计失败"));
    renderWithProviders(<AuditPanel />);

    expect(await screen.findByText("审计失败")).toBeInTheDocument();
  });

  it("says so when there is nothing to audit", async () => {
    api.reportAudit.mockResolvedValue(null);
    renderWithProviders(<AuditPanel />);

    await waitFor(() =>
      expect(screen.getByText("该区间没有记录")).toBeInTheDocument(),
    );
  });
});
