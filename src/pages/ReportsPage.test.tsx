import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

/**
 * The six report bodies have their own suites; this file is about the page:
 * the URL is the source of truth, the catalogue switches the body, and the
 * print action is handed to the window header.
 */
vi.mock("@/components/reports/CashflowReport", () => ({
  CashflowReport: () => <div>cashflow-body</div>,
}));
vi.mock("@/components/reports/CategoryBreakdownReport", () => ({
  CategoryBreakdownReport: () => <div>categories-body</div>,
}));
vi.mock("@/components/reports/NetWorthAttributionReport", () => ({
  NetWorthAttributionReport: () => <div>netWorth-body</div>,
}));
vi.mock("@/components/reports/BalanceSheetReport", () => ({
  BalanceSheetReport: () => <div>balanceSheet-body</div>,
}));
vi.mock("@/components/reports/AccountDetailReport", () => ({
  AccountDetailReport: () => <div>accounts-body</div>,
}));
vi.mock("@/components/reports/BudgetExecutionReport", () => ({
  BudgetExecutionReport: () => <div>budgets-body</div>,
}));

const { setActions } = vi.hoisted(() => ({ setActions: vi.fn() }));

// The provider itself is exercised by the shell; the page only needs the API.
// Mocking it also keeps the `setActions` effect from looping, which it would
// under the global `useTranslation` mock because `t` gets a new identity on
// every render (the real one is stable per language).
vi.mock("@/contexts/HeaderContext", () => ({
  HeaderProvider: ({ children }: { children: React.ReactNode }) => children,
  useHeaderActions: () => ({ setActions }),
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  const source = actual as unknown as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...source };
  for (const key of Object.keys(source)) {
    if (typeof source[key] === "function") {
      mocked[key] = vi.fn().mockResolvedValue({});
    }
  }
  return mocked;
});

import { ReportsPage } from "@/pages/ReportsPage";

function renderReports(route = "/reports") {
  return renderWithProviders(<ReportsPage />, { route });
}

describe("ReportsPage", () => {
  it("defaults to the cashflow report and hands print to the header", async () => {
    renderReports();

    expect(await screen.findByText("cashflow-body")).toBeInTheDocument();
    // The print button lives in the window header, not on the page: the page
    // only hands it over.
    expect(setActions).toHaveBeenCalledWith(expect.anything());
  });

  it("opens the report named in the URL", async () => {
    renderReports("/reports?r=balanceSheet");
    expect(await screen.findByText("balanceSheet-body")).toBeInTheDocument();
    expect(screen.getByRole("button", { current: "page" })).toHaveTextContent(
      "资产负债表",
    );
  });

  it("falls back to cashflow for an unknown report id", async () => {
    renderReports("/reports?r=nope");
    expect(await screen.findByText("cashflow-body")).toBeInTheDocument();
  });

  it("switches the body when the catalogue is clicked", async () => {
    renderReports();
    await screen.findByText("cashflow-body");

    fireEvent.click(screen.getByText("分类构成"));

    await waitFor(() =>
      expect(screen.getByText("categories-body")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { current: "page" })).toHaveTextContent(
      "分类构成",
    );
  });

  it("lists every report in the catalogue", async () => {
    renderReports();
    const nav = await screen.findByRole("navigation");

    expect(nav.querySelectorAll("button")).toHaveLength(6);
  });
});
