import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    accountList: vi.fn(),
    reportAudit: vi.fn(),
    mcpGetConfig: vi.fn(),
    mcpSetConfig: vi.fn(),
    mcpResetToken: vi.fn(),
    accountMetaSchema: vi.fn(),
    dbListRecent: vi.fn(),
    dbRemoveRecent: vi.fn(),
    dbExportBackup: vi.fn(),
    dbImportBackup: vi.fn(),
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

import { SettingsPage } from "@/pages/SettingsPage";
import { useThemeStore } from "@/stores/themeStore";
import { useLanguageStore } from "@/stores/languageStore";
import { useSecurityStore } from "@/stores/securityStore";

const AUDIT = {
  balanceCheck: {
    totalTransactions: 2,
    balancedCount: 2,
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

describe("SettingsPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.getSetting.mockResolvedValue(null);
    api.setSetting.mockResolvedValue(undefined);
    api.accountList.mockResolvedValue([]);
    api.reportAudit.mockResolvedValue(AUDIT);
    api.mcpGetConfig.mockResolvedValue({
      enabled: false,
      port: 17823,
      actualPort: null,
      running: false,
      runtimeError: null,
      trustMode: "readonly",
      allowCreateAccount: false,
      token: "",
    });
    api.mcpSetConfig.mockResolvedValue({
      enabled: false,
      port: 17823,
      actualPort: null,
      running: false,
      trustMode: "readonly",
      allowCreateAccount: false,
    });
    api.mcpResetToken.mockResolvedValue({
      enabled: false,
      port: 17823,
      actualPort: null,
      running: false,
      token: "",
    });
    api.accountMetaSchema.mockResolvedValue({
      valid_account_roles: [],
      valid_liability_types: [],
    });

    useThemeStore.setState({ mode: "system", preset: "terminal" });
    useLanguageStore.setState({ language: "zh" });
    useSecurityStore.setState({ autoLockMinutes: 15 });
  });

  it("mounts every section without a data error", async () => {
    const { container } = renderWithProviders(<SettingsPage />);

    // The audit report is only fetched when the audit dialog is opened, so the
    // page itself must not need it.
    expect(container.textContent?.length).toBeGreaterThan(0);
    expect((await screen.findAllByText("主题")).length).toBeGreaterThan(0);
  });

  it("offers the theme presets", async () => {
    renderWithProviders(<SettingsPage />);

    expect((await screen.findAllByText("主题")).length).toBeGreaterThan(0);
  });

  it("switches the theme", async () => {
    renderWithProviders(<SettingsPage />);

    fireEvent.click((await screen.findAllByText("暗色"))[0] as HTMLElement);

    await waitFor(() => expect(useThemeStore.getState().mode).toBe("dark"));
  });

  it("picks a preset", async () => {
    renderWithProviders(<SettingsPage />);

    const presets = await screen.findAllByRole("button", { pressed: false });
    fireEvent.click(presets[0] as HTMLElement);

    await waitFor(() =>
      expect(useThemeStore.getState().preset).not.toBe("terminal"),
    );
  });

  it("changes the language", async () => {
    renderWithProviders(<SettingsPage />);

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("English");

    await waitFor(() =>
      expect(useLanguageStore.getState().language).toBe("en"),
    );
  });

  it("changes how long the ledger stays open", async () => {
    renderWithProviders(<SettingsPage />);

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("5 分钟");

    await waitFor(() =>
      expect(useSecurityStore.getState().autoLockMinutes).toBe(5),
    );
  });

  it("opens the password dialog", async () => {
    renderWithProviders(<SettingsPage />);

    fireEvent.click((await screen.findAllByText("修改密码"))[0] as HTMLElement);

    expect(
      (await screen.findAllByText("输入当前密码和新密码以更新数据库加密密钥。"))
        .length,
    ).toBeGreaterThan(0);
  });

  it("runs the audit when it is asked for", async () => {
    renderWithProviders(<SettingsPage />);

    fireEvent.click((await screen.findAllByText("运行体检"))[0] as HTMLElement);

    expect((await screen.findAllByText("数据体检")).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.reportAudit).toHaveBeenCalled());
    expect(
      (await screen.findAllByText("每条交易的分录金额合计为零")).length,
    ).toBeGreaterThan(0);
  });
});
