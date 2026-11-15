import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AiSettingsSection } from "@/components/settings/AiSettingsSection";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: {
    accountList: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    aiTestConnection: vi.fn(),
  },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const ACCOUNTS = [
  { id: "acc1", name: "现金", account_type: "asset", is_active: true },
  { id: "acc2", name: "工资", account_type: "income", is_active: true },
  { id: "acc3", name: "停用账户", account_type: "asset", is_active: false },
];

describe("AiSettingsSection", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.accountList.mockResolvedValue(ACCOUNTS);
    api.getSetting.mockResolvedValue(null);
    api.setSetting.mockResolvedValue(undefined);
    api.aiTestConnection.mockResolvedValue(undefined);
  });

  it("shows the empty settings", async () => {
    renderWithProviders(<AiSettingsSection />);

    expect(await screen.findByText("AI 记账")).toBeInTheDocument();
    expect(
      (
        screen.getByPlaceholderText(
          "https://api.openai.com/v1",
        ) as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("shows the settings that were saved before", async () => {
    api.getSetting.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        "ai.provider": "deepseek",
        "ai.base_url": "https://api.deepseek.com/v1",
        "ai.api_key": "sk-test",
        "ai.model": "gpt-4o-mini",
        "ai.default_source_account_id": "acc1",
      };
      return Promise.resolve(values[key] ?? null);
    });
    renderWithProviders(<AiSettingsSection />);

    await waitFor(() =>
      expect(
        (
          screen.getByPlaceholderText(
            "https://api.openai.com/v1",
          ) as HTMLInputElement
        ).value,
      ).toBe("https://api.deepseek.com/v1"),
    );
    expect(
      (screen.getByPlaceholderText("sk-...") as HTMLInputElement).value,
    ).toBe("sk-test");
  });

  it("reports a setting it cannot read", async () => {
    api.getSetting.mockRejectedValue(new Error("读取失败"));
    renderWithProviders(<AiSettingsSection />);

    expect(await screen.findByText("读取失败")).toBeInTheDocument();
  });

  it("saves the settings", async () => {
    renderWithProviders(<AiSettingsSection />);
    await screen.findByText("AI 记账");

    fireEvent.change(screen.getByPlaceholderText("https://api.openai.com/v1"), {
      target: { value: "https://example.com/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.setSetting).toHaveBeenCalledWith(
        "ai.base_url",
        "https://example.com/v1",
      ),
    );
    expect(api.setSetting).toHaveBeenCalledWith("ai.provider", "openai");
  });

  it("reports a setting it cannot save", async () => {
    api.setSetting.mockRejectedValue(new Error("保存失败"));
    renderWithProviders(<AiSettingsSection />);
    await screen.findByText("AI 记账");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("保存失败")).toBeInTheDocument();
  });

  it("shows the key only when it is asked for", async () => {
    renderWithProviders(<AiSettingsSection />);
    await screen.findByText("AI 记账");

    const key = screen.getByPlaceholderText("sk-...");
    expect(key).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "显示" }));
    expect(key).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "隐藏" }));
    expect(key).toHaveAttribute("type", "password");
  });

  it("fills in the address of the provider that was picked", async () => {
    renderWithProviders(<AiSettingsSection />);
    await screen.findByText("AI 记账");

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("Ollama (本地)");

    await waitFor(() =>
      expect(
        (
          screen.getByPlaceholderText(
            "https://api.openai.com/v1",
          ) as HTMLInputElement
        ).value,
      ).toBe("http://localhost:11434/v1"),
    );
  });

  it("offers the active asset accounts as the source", async () => {
    renderWithProviders(<AiSettingsSection />);
    await screen.findByText("AI 记账");

    const triggers = screen.getAllByRole("combobox");
    await openSelect(triggers[1] as HTMLElement);
    clickOption("现金");

    await waitFor(() => expect(api.setSetting).not.toHaveBeenCalled());
    expect(screen.getByText("现金")).toBeInTheDocument();
  });

  it("tests the connection after saving", async () => {
    renderWithProviders(<AiSettingsSection />);
    await screen.findByText("AI 记账");

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByText("连接成功")).toBeInTheDocument();
    expect(api.aiTestConnection).toHaveBeenCalled();
  });

  it("reports a connection that cannot be made", async () => {
    api.aiTestConnection.mockRejectedValue(new Error("连不上"));
    renderWithProviders(<AiSettingsSection />);
    await screen.findByText("AI 记账");

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByText("连不上")).toBeInTheDocument();
  });

  it("does not test the connection when the settings cannot be saved", async () => {
    api.setSetting.mockRejectedValue(new Error("保存失败"));
    renderWithProviders(<AiSettingsSection />);
    await screen.findByText("AI 记账");

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() =>
      expect(screen.getByText("保存失败")).toBeInTheDocument(),
    );
    expect(api.aiTestConnection).not.toHaveBeenCalled();
  });
});
