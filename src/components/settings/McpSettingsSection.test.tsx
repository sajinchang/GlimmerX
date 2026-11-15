import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { McpSettingsSection } from "@/components/settings/McpSettingsSection";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: {
    mcpGetConfig: vi.fn(),
    mcpSetConfig: vi.fn(),
    mcpResetToken: vi.fn(),
  },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const CONFIG = {
  enabled: true,
  port: 17823,
  actualPort: 17823,
  running: true,
  runtimeError: null,
  trustMode: "readonly",
  allowCreateAccount: false,
  token: "secret-token",
};

describe("McpSettingsSection", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.mcpGetConfig.mockResolvedValue(CONFIG);
    api.mcpSetConfig.mockResolvedValue(CONFIG);
    api.mcpResetToken.mockResolvedValue({
      ...CONFIG,
      token: "new-token",
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows the configuration it read", async () => {
    renderWithProviders(<McpSettingsSection />);

    expect(
      await screen.findByText(/运行中 · 127\.0\.0\.1:17823/),
    ).toBeInTheDocument();
    expect(
      (screen.getByDisplayValue("secret-token") as HTMLInputElement).value,
    ).toBe("secret-token");
    expect(
      screen.getAllByText(/127\.0\.0\.1:17823\/mcp/).length,
    ).toBeGreaterThan(0);
  });

  it("says so when the server is not running", async () => {
    api.mcpGetConfig.mockResolvedValue({
      ...CONFIG,
      running: false,
      actualPort: null,
    });
    renderWithProviders(<McpSettingsSection />);

    expect(await screen.findByText("未运行")).toBeInTheDocument();
  });

  it("says so when the server could not start", async () => {
    api.mcpGetConfig.mockResolvedValue({
      ...CONFIG,
      running: false,
      actualPort: null,
      runtimeError: "端口被占用",
    });
    renderWithProviders(<McpSettingsSection />);

    expect(await screen.findByText(/端口被占用/)).toBeInTheDocument();
  });

  it("reports a configuration it cannot read", async () => {
    api.mcpGetConfig.mockRejectedValue(new Error("读不到"));
    renderWithProviders(<McpSettingsSection />);

    expect(await screen.findByText("读不到")).toBeInTheDocument();
  });

  it("switches the server on and off", async () => {
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0] as HTMLElement);

    await waitFor(() =>
      expect(api.mcpSetConfig).toHaveBeenCalledWith({ enabled: false }),
    );
  });

  it("applies a new port", async () => {
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    fireEvent.change(screen.getByDisplayValue("17823") as HTMLInputElement, {
      target: { value: "18000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() =>
      expect(api.mcpSetConfig).toHaveBeenCalledWith({ port: 18000 }),
    );
  });

  it("refuses a port that makes no sense", async () => {
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    fireEvent.change(screen.getByDisplayValue("17823") as HTMLInputElement, {
      target: { value: "70000" },
    });

    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
  });

  it("changes the trust level", async () => {
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    const trigger = screen.getByRole("combobox");
    await openSelect(trigger);
    clickOption("信任（直接写入）");

    await waitFor(() =>
      expect(api.mcpSetConfig).toHaveBeenCalledWith({ trust: "trust" }),
    );
  });

  it("lets the agents create accounts", async () => {
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1] as HTMLElement);

    await waitFor(() =>
      expect(api.mcpSetConfig).toHaveBeenCalledWith({
        allowCreateAccount: true,
      }),
    );
  });

  it("copies the token", async () => {
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    const tokenInput = screen.getByDisplayValue("secret-token");
    const copyButton = tokenInput.parentElement?.querySelector(
      "button",
    ) as HTMLElement;
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "secret-token",
      ),
    );
  });

  it("copies the client configuration", async () => {
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    fireEvent.click(screen.getByRole("button", { name: "复制 MCP 配置" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("glimmerx"),
      ),
    );
  });

  it("keeps the token when the clipboard refuses", async () => {
    (
      navigator.clipboard.writeText as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("没有权限"));
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    const tokenInput = screen.getByDisplayValue("secret-token");
    const copyButton = tokenInput.parentElement?.querySelector(
      "button",
    ) as HTMLElement;
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalled(),
    );
  });

  it("gives the token a new one", async () => {
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    fireEvent.click(screen.getByTitle("重置令牌"));

    await waitFor(() => expect(api.mcpResetToken).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (screen.getByDisplayValue("new-token") as HTMLInputElement).value,
      ).toBe("new-token"),
    );
  });

  it("reports a configuration it cannot save", async () => {
    api.mcpSetConfig.mockRejectedValue(new Error("存不了"));
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0] as HTMLElement);

    expect(await screen.findByText("存不了")).toBeInTheDocument();
  });

  it("reports a token it cannot reset", async () => {
    api.mcpResetToken.mockRejectedValue(new Error("换不了"));
    renderWithProviders(<McpSettingsSection />);
    await screen.findByText(/运行中/);

    fireEvent.click(screen.getByTitle("重置令牌"));

    expect(await screen.findByText("换不了")).toBeInTheDocument();
  });
});
