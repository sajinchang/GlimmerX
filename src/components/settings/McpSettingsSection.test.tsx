import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { McpSettingsSection } from "./McpSettingsSection";

vi.mock("@/utils/api", () => ({
  setUiLanguage: vi.fn().mockResolvedValue(undefined),
  mcpGetConfig: vi.fn(),
  mcpSetConfig: vi.fn(),
  mcpResetToken: vi.fn(),
}));

vi.mock("@/utils/errorTranslation", () => ({
  translateErrorMessage: vi.fn((err) => String(err)),
}));

import { mcpGetConfig, mcpSetConfig, mcpResetToken } from "@/utils/api";

const mockGet = mcpGetConfig as ReturnType<typeof vi.fn>;
const mockSet = mcpSetConfig as ReturnType<typeof vi.fn>;
const mockReset = mcpResetToken as ReturnType<typeof vi.fn>;

const baseConfig = {
  enabled: false,
  port: 17823,
  actualPort: null,
  running: false,
  runtimeError: null,
  trustMode: "readonly",
  allowCreateAccount: false,
  token: "a".repeat(64),
};

describe("McpSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ ...baseConfig });
  });

  it("shows the disabled state with the stored token", async () => {
    render(<McpSettingsSection />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("a".repeat(64))).toBeInTheDocument();
    });
    expect(screen.getByText(/未运行|Not running/)).toBeInTheDocument();
    // The client config block embeds the token and the preferred port.
    expect(screen.getByText(/127\.0\.0\.1:17823\/mcp/)).toBeInTheDocument();
  });

  it("flipping the switch persists enabled and reflects the running state", async () => {
    mockSet.mockResolvedValue({
      ...baseConfig,
      enabled: true,
      running: true,
      actualPort: 17823,
    });
    render(<McpSettingsSection />);
    await screen.findByDisplayValue("a".repeat(64));

    // Two switches now (server on/off and account creation); the server
    // toggle is the first one in the section.
    const toggle = screen.getAllByRole("switch")[0]!;
    // Radix Switch needs the pointer lifecycle in jsdom, a bare click is a
    // no-op on it.
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockSet).toHaveBeenCalledWith({ enabled: true });
    });
    await waitFor(() => {
      expect(
        screen.getByText(/运行中 · 127\.0\.0\.1:17823/),
      ).toBeInTheDocument();
    });
  });

  it("changing the trust mode persists it", async () => {
    mockSet.mockResolvedValue({ ...baseConfig });
    render(<McpSettingsSection />);
    await screen.findByDisplayValue("a".repeat(64));

    // Open the trust select (shadcn Select) and move it off the default.
    // Picking the tier that is already selected fires no change event, and
    // read-only is the default now.
    fireEvent.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", {
      name: /信任|write directly/i,
    });
    fireEvent.click(option);

    await waitFor(() => {
      expect(mockSet).toHaveBeenCalledWith({ trust: "trust" });
    });
  });

  it("resetting the token rotates the shown value", async () => {
    mockReset.mockResolvedValue({
      ...baseConfig,
      token: "b".repeat(64),
    });
    render(<McpSettingsSection />);
    await screen.findByDisplayValue("a".repeat(64));

    const reset = screen.getByTitle(/重置令牌|Reset token/);
    fireEvent.click(reset);

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue("b".repeat(64))).toBeInTheDocument();
    });
  });
  it("explains why the server is not running", async () => {
    mockGet.mockResolvedValue({
      ...baseConfig,
      enabled: true,
      running: false,
      runtimeError: "no free port in 127.0.0.1:17823..17832",
    });

    render(<McpSettingsSection />);

    // The switch is on but nothing listens: "not running" alone would look
    // like the user simply turned it off.
    // The suite renders in Chinese (the default locale), so match either.
    expect(
      await screen.findByText(/启动失败|Could not start/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no free port in 127\.0\.0\.1:17823/),
    ).toBeInTheDocument();
  });
});
