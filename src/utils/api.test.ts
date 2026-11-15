import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "@/utils/api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api invokeCommand", () => {
  it("calls tauri invoke with command and args", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true });
    const result = await api.invokeCommand("test_cmd", { foo: "bar" });
    expect(mockedInvoke).toHaveBeenCalledWith("test_cmd", { foo: "bar" });
    expect(result).toEqual({ ok: true });
  });

  it("calls invoke without args", async () => {
    mockedInvoke.mockResolvedValueOnce(42);
    const result = await api.invokeCommand("no_args");
    expect(mockedInvoke).toHaveBeenCalledWith("no_args", undefined);
    expect(result).toBe(42);
  });
});

describe("api database commands", () => {
  it("dbCreate calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce({ path: "/test.db" });
    const result = await api.dbCreate("/test.db", "secret");
    expect(mockedInvoke).toHaveBeenCalledWith("db_create", {
      path: "/test.db",
      password: "secret",
    });
    expect(result.path).toBe("/test.db");
  });

  it("dbUnlock calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce({ path: "/test.db" });
    await api.dbUnlock("/test.db", "secret");
    expect(mockedInvoke).toHaveBeenCalledWith("db_unlock", {
      path: "/test.db",
      password: "secret",
    });
  });

  it("dbChangePassword calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await api.dbChangePassword("old", "new");
    expect(mockedInvoke).toHaveBeenCalledWith("db_change_password", {
      oldPassword: "old",
      newPassword: "new",
    });
  });

  it("dbCheckExists calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await api.dbCheckExists("/test.db");
    expect(mockedInvoke).toHaveBeenCalledWith("db_check_exists", {
      path: "/test.db",
    });
    expect(result).toBe(true);
  });

  it("dbCheckAnyExists calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce(false);
    const result = await api.dbCheckAnyExists();
    expect(mockedInvoke).toHaveBeenCalledWith("db_check_any_exists", undefined);
    expect(result).toBe(false);
  });

  it("dbListRecent calls invoke", async () => {
    const recent = [
      { path: "/a.db", label: "a", lastOpened: "2026-01-01", exists: true },
    ];
    mockedInvoke.mockResolvedValueOnce(recent);
    const result = await api.dbListRecent();
    expect(mockedInvoke).toHaveBeenCalledWith("db_list_recent", undefined);
    expect(result).toEqual(recent);
  });

  it("dbRemoveRecent calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await api.dbRemoveRecent("/test.db");
    expect(mockedInvoke).toHaveBeenCalledWith("db_remove_recent", {
      path: "/test.db",
    });
  });

  it("dbLock calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await api.dbLock();
    expect(mockedInvoke).toHaveBeenCalledWith("db_lock", undefined);
  });
});

describe("api account commands", () => {
  it("accountCreate calls invoke", async () => {
    const input = { name: "Test" };
    mockedInvoke.mockResolvedValueOnce({ id: "1", ...input });
    const result = await api.accountCreate(input);
    expect(mockedInvoke).toHaveBeenCalledWith("account_create", { input });
    expect(result.id).toBe("1");
  });

  it("accountList calls invoke without a type filter", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await api.accountList();
    expect(mockedInvoke).toHaveBeenCalledWith("account_list", { types: null });
  });

  it("accountList passes the type filter through", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await api.accountList(["asset", "liability"]);
    expect(mockedInvoke).toHaveBeenCalledWith("account_list", {
      types: ["asset", "liability"],
    });
  });

  it("accountUpdate calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce({ id: "1" });
    await api.accountUpdate("1", { name: "Updated" });
    expect(mockedInvoke).toHaveBeenCalledWith("account_update", {
      id: "1",
      input: { name: "Updated" },
    });
  });

  it("accountDelete calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await api.accountDelete("1");
    expect(mockedInvoke).toHaveBeenCalledWith("account_delete", { id: "1" });
  });

  it("accountBalance calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce(5000);
    const result = await api.accountBalance("1");
    expect(mockedInvoke).toHaveBeenCalledWith("account_balance", { id: "1" });
    expect(result).toBe(5000);
  });

  it("accountTransfer calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce("transfer-id");
    const result = await api.accountTransfer("1", "2", 100, "desc");
    expect(mockedInvoke).toHaveBeenCalledWith("account_transfer", {
      fromId: "1",
      toId: "2",
      amount: 100,
      description: "desc",
    });
    expect(result).toBe("transfer-id");
  });

  it("accountBatchCreate calls invoke", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await api.accountBatchCreate([{ name: "A" }]);
    expect(mockedInvoke).toHaveBeenCalledWith("account_batch_create", {
      inputs: [{ name: "A" }],
    });
  });

  it("accountTransactions calls invoke with date range", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await api.accountTransactions("1", "2026-01-01", "2026-04-01");
    expect(mockedInvoke).toHaveBeenCalledWith("account_transactions", {
      id: "1",
      fromDate: "2026-01-01",
      toDate: "2026-04-01",
    });
  });

  it("accountTransactions calls invoke without date range", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await api.accountTransactions("1");
    expect(mockedInvoke).toHaveBeenCalledWith("account_transactions", {
      id: "1",
    });
  });
});

interface ApiCase {
  name: string;
  cmd: string;
  args: unknown;
  call: () => Promise<unknown>;
}

/**
 * Every remaining wrapper, asserted one by one. The point is not the return
 * value — `invokeCommand` is already covered — but that each wrapper sends the
 * command name and the exact argument keys the Rust side deserializes. A typo
 * here fails at runtime with "missing required key", not at compile time,
 * because the IPC boundary is untyped.
 */
const apiCases: ApiCase[] = [
  {
    name: "dbIsUnlocked",
    cmd: "db_is_unlocked",
    args: undefined,
    call: () => api.dbIsUnlocked(),
  },
  { name: "dbPing", cmd: "db_ping", args: undefined, call: () => api.dbPing() },
  {
    name: "accountBalancesBatch",
    cmd: "account_balances_batch",
    args: { ids: ["a"] },
    call: () => api.accountBalancesBatch(["a"]),
  },
  {
    name: "accountMetaGet",
    cmd: "account_meta_get",
    args: { accountId: "a" },
    call: () => api.accountMetaGet("a"),
  },
  {
    name: "accountMetaSet",
    cmd: "account_meta_set",
    args: { accountId: "a", key: "k", value: "v" },
    call: () => api.accountMetaSet("a", "k", "v"),
  },
  {
    name: "accountMetaBatchSet",
    cmd: "account_meta_batch_set",
    args: { accountId: "a", metas: [{ key: "k", value: "v" }] },
    call: () => api.accountMetaBatchSet("a", [{ key: "k", value: "v" }]),
  },
  {
    name: "accountMetaSchema",
    cmd: "account_meta_schema",
    args: undefined,
    call: () => api.accountMetaSchema(),
  },
  {
    name: "categoryList",
    cmd: "category_list",
    args: { type: "income" },
    call: () => api.categoryList("income"),
  },
  {
    name: "categoryCreate",
    cmd: "category_create",
    args: { input: { name: "餐饮" } },
    call: () => api.categoryCreate({ name: "餐饮" } as never),
  },
  {
    name: "categoryUpdate",
    cmd: "category_update",
    args: { id: "c1", input: { name: "外卖" } },
    call: () => api.categoryUpdate("c1", { name: "外卖" } as never),
  },
  {
    name: "categoryDelete",
    cmd: "category_delete",
    args: { id: "c1", cascade: true },
    call: () => api.categoryDelete("c1", true),
  },
  {
    name: "categoryDeletePreview",
    cmd: "category_delete_preview",
    args: { id: "c1" },
    call: () => api.categoryDeletePreview("c1"),
  },
  {
    name: "transactionCreate",
    cmd: "transaction_create",
    args: { input: { date: "2026-11-15" } },
    call: () => api.transactionCreate({ date: "2026-11-15" } as never),
  },
  {
    name: "transactionList",
    cmd: "transaction_list",
    args: { filter: { fromDate: "2026-11-01" } },
    call: () => api.transactionList({ fromDate: "2026-11-01" } as never),
  },
  {
    name: "transactionGet",
    cmd: "transaction_get",
    args: { id: "t1" },
    call: () => api.transactionGet("t1"),
  },
  {
    name: "transactionListPaginated",
    cmd: "transaction_list_paginated",
    args: { filter: { page: 2 } },
    call: () => api.transactionListPaginated({ page: 2 } as never),
  },
  {
    name: "quickAddTransaction",
    cmd: "quick_add_transaction",
    args: { input: { amount: "12.00" } },
    call: () => api.quickAddTransaction({ amount: "12.00" } as never),
  },
  {
    name: "quickReplaceTransaction",
    cmd: "quick_replace_transaction",
    args: { id: "t1", input: { amount: "13.00" } },
    call: () => api.quickReplaceTransaction("t1", { amount: "13.00" } as never),
  },
  {
    name: "aiParseTransaction",
    cmd: "ai_parse_transaction",
    args: { text: "午饭 30" },
    call: () => api.aiParseTransaction("午饭 30"),
  },
  {
    name: "aiTestConnection",
    cmd: "ai_test_connection",
    args: undefined,
    call: () => api.aiTestConnection(),
  },
  {
    name: "getSetting",
    cmd: "get_setting",
    args: { key: "theme" },
    call: () => api.getSetting("theme"),
  },
  {
    name: "setSetting",
    cmd: "set_setting",
    args: { key: "theme", value: "dark" },
    call: () => api.setSetting("theme", "dark"),
  },
  {
    name: "transactionDetail",
    cmd: "transaction_detail",
    args: { id: "t1" },
    call: () => api.transactionDetail("t1"),
  },
  {
    name: "transactionUpdate",
    cmd: "transaction_update",
    args: { id: "t1", input: { memo: "x" } },
    call: () => api.transactionUpdate("t1", { memo: "x" } as never),
  },
  {
    name: "transactionDeletePreview",
    cmd: "transaction_delete_preview",
    args: { id: "t1" },
    call: () => api.transactionDeletePreview("t1"),
  },
  {
    name: "transactionDelete",
    cmd: "transaction_delete",
    args: { id: "t1" },
    call: () => api.transactionDelete("t1"),
  },
  {
    name: "dashboardSummary",
    cmd: "dashboard_summary",
    args: { fromDate: "2026-11-01", toDate: "2026-11-30" },
    call: () =>
      api.dashboardSummary({ fromDate: "2026-11-01", toDate: "2026-11-30" }),
  },
  {
    name: "dashboardMonthlyChart",
    cmd: "dashboard_monthly_chart",
    args: { year: 2026, month: 11 },
    call: () => api.dashboardMonthlyChart({ year: 2026, month: 11 }),
  },
  {
    name: "dashboardCategoryBreakdown",
    cmd: "dashboard_category_breakdown",
    args: { categoryType: "expense" },
    call: () => api.dashboardCategoryBreakdown({ categoryType: "expense" }),
  },
  {
    name: "dashboardTopExpenses",
    cmd: "dashboard_top_expenses",
    args: { limit: 5 },
    call: () => api.dashboardTopExpenses({ limit: 5 }),
  },
  {
    name: "budgetList",
    cmd: "budget_list",
    args: undefined,
    call: () => api.budgetList(),
  },
  {
    name: "budgetListStatuses",
    cmd: "budget_list_statuses",
    args: { year: 2026, month: 11 },
    call: () => api.budgetListStatuses(2026, 11),
  },
  {
    name: "budgetCreate",
    cmd: "budget_create",
    args: { input: { amount: "100.00" } },
    call: () => api.budgetCreate({ amount: "100.00" } as never),
  },
  {
    name: "budgetUpdate",
    cmd: "budget_update",
    args: { id: "b1", input: { amount: "200.00" } },
    call: () => api.budgetUpdate("b1", { amount: "200.00" } as never),
  },
  {
    name: "budgetDelete",
    cmd: "budget_delete",
    args: { id: "b1" },
    call: () => api.budgetDelete("b1"),
  },
  {
    name: "reportStandard",
    cmd: "report_standard",
    args: { filter: { compare: "none" } },
    call: () => api.reportStandard({ compare: "none" } as never),
  },
  {
    name: "reportCategoryBreakdown",
    cmd: "report_category_breakdown",
    args: { filter: { compare: "none" }, incomeOrExpense: "income" },
    call: () =>
      api.reportCategoryBreakdown({ compare: "none" } as never, "income"),
  },
  {
    name: "reportBalanceSheet",
    cmd: "report_balance_sheet",
    args: { snapshotDate: "2026-11-30" },
    call: () => api.reportBalanceSheet("2026-11-30"),
  },
  {
    name: "reportTrend",
    cmd: "report_trend",
    args: { filter: { compare: "none" } },
    call: () => api.reportTrend({ compare: "none" } as never),
  },
  {
    name: "reportAccountTransactions",
    cmd: "report_account_transactions",
    args: {
      accountId: "a1",
      filter: { compare: "none" },
      page: 3,
      pageSize: 20,
    },
    call: () =>
      api.reportAccountTransactions("a1", { compare: "none" } as never, 3, 20),
  },
  {
    name: "reportAccountTransactions defaults",
    cmd: "report_account_transactions",
    args: {
      accountId: "a1",
      filter: { compare: "none" },
      page: 1,
      pageSize: 50,
    },
    call: () =>
      api.reportAccountTransactions("a1", { compare: "none" } as never),
  },
  {
    name: "reportAccountBalanceTrend",
    cmd: "report_account_balance_trend",
    args: { accountId: "a1", filter: { compare: "none" } },
    call: () =>
      api.reportAccountBalanceTrend("a1", { compare: "none" } as never),
  },
  {
    name: "reportAudit",
    cmd: "report_audit",
    args: undefined,
    call: () => api.reportAudit(),
  },
  {
    name: "dbBackup",
    cmd: "db_backup",
    args: { backupPath: "/tmp/b.db" },
    call: () => api.dbBackup("/tmp/b.db"),
  },
  {
    name: "reconcilePreview",
    cmd: "reconcile_preview",
    args: { accountId: "a1", statementDate: "2026-11-30" },
    call: () => api.reconcilePreview("a1", "2026-11-30"),
  },
  {
    name: "reconcileAutoMatch",
    cmd: "reconcile_auto_match",
    args: { accountId: "a1", statementDate: "2026-11-30", amounts: ["10.00"] },
    call: () => api.reconcileAutoMatch("a1", "2026-11-30", ["10.00"]),
  },
  {
    name: "reconcileTotals",
    cmd: "reconcile_totals",
    args: {
      accountId: "a1",
      statementDate: "2026-11-30",
      closingBalance: "0.00",
      postingIds: ["p1"],
    },
    call: () => api.reconcileTotals("a1", "2026-11-30", "0.00", ["p1"]),
  },
  {
    name: "reconcileCreate",
    cmd: "reconcile_create",
    args: {
      input: {
        accountId: "a1",
        statementDate: "2026-11-30",
        closingBalance: "0.00",
        postingIds: ["p1"],
      },
    },
    call: () => api.reconcileCreate("a1", "2026-11-30", "0.00", ["p1"]),
  },
  {
    name: "reconcileList",
    cmd: "reconcile_list",
    args: { accountId: "a1" },
    call: () => api.reconcileList("a1"),
  },
  {
    name: "reconcileUndo",
    cmd: "reconcile_undo",
    args: { id: "r1" },
    call: () => api.reconcileUndo("r1"),
  },
  {
    name: "savingsList",
    cmd: "savings_list",
    args: undefined,
    call: () => api.savingsList(),
  },
  {
    name: "savingsCreate",
    cmd: "savings_create",
    args: { input: { name: "旅行" } },
    call: () => api.savingsCreate({ name: "旅行" } as never),
  },
  {
    name: "savingsUpdate",
    cmd: "savings_update",
    args: { id: "s1", input: { name: "海岛" } },
    call: () => api.savingsUpdate("s1", { name: "海岛" } as never),
  },
  {
    name: "savingsSetStatus",
    cmd: "savings_set_status",
    args: { id: "s1", status: "achieved" },
    call: () => api.savingsSetStatus("s1", "achieved"),
  },
  {
    name: "savingsDelete",
    cmd: "savings_delete",
    args: { id: "s1" },
    call: () => api.savingsDelete("s1"),
  },
  {
    name: "mcpGetConfig",
    cmd: "mcp_get_config",
    args: undefined,
    call: () => api.mcpGetConfig(),
  },
  {
    name: "mcpSetConfig",
    cmd: "mcp_set_config",
    args: { enabled: true, port: 17823 },
    call: () => api.mcpSetConfig({ enabled: true, port: 17823 }),
  },
  {
    name: "mcpResetToken",
    cmd: "mcp_reset_token",
    args: undefined,
    call: () => api.mcpResetToken(),
  },
];

describe("api wrappers forward the right command and payload", () => {
  it.each(apiCases)("$name", async ({ cmd, args, call }) => {
    mockedInvoke.mockResolvedValueOnce(null);
    await call();
    expect(mockedInvoke).toHaveBeenCalledWith(cmd, args);
  });

  it("setUiLanguage is a no-op outside a Tauri runtime", async () => {
    await api.setUiLanguage("en");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("setUiLanguage reaches the backend inside Tauri", async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });

    await api.setUiLanguage("zh");

    expect(mockedInvoke).toHaveBeenCalledWith("set_ui_language", {
      language: "zh",
    });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });
});
