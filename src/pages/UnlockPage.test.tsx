import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: {
    dbCreate: vi.fn(),
    dbUnlock: vi.fn(),
    dbLock: vi.fn(),
    dbCheckExists: vi.fn(),
    dbRemoveRecent: vi.fn(),
    dbPing: vi.fn(),
    dbListRecent: vi.fn(),
  },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const { dialog } = vi.hoisted(() => ({
  dialog: { open: vi.fn(), save: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: dialog.open,
  save: dialog.save,
}));

const { paths } = vi.hoisted(() => ({
  paths: {
    documentDir: vi.fn(),
    homeDir: vi.fn(),
    resolve: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  documentDir: paths.documentDir,
  homeDir: paths.homeDir,
  resolve: paths.resolve,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

import { UnlockPage } from "@/pages/UnlockPage";
import { useDbStore } from "@/stores/dbStore";
import { toast } from "sonner";

const RECENT = [
  {
    path: "/home/sam/ledger.db",
    label: "ledger.db",
    lastOpened: "2026-11-01T10:00:00+08:00",
    exists: true,
  },
  {
    path: "/home/sam/gone.db",
    label: "gone.db",
    lastOpened: "2026-10-01T10:00:00+08:00",
    exists: false,
  },
];

function passwordBox() {
  return document.querySelector("#password") as HTMLInputElement;
}

function typePassword(value: string) {
  fireEvent.change(passwordBox(), { target: { value } });
}

describe("UnlockPage", () => {
  beforeEach(() => {
    api.dbCreate.mockReset();
    api.dbUnlock.mockReset();
    api.dbLock.mockReset();
    api.dbCheckExists.mockReset();
    api.dbRemoveRecent.mockReset();
    api.dbPing.mockReset();
    api.dbListRecent.mockReset();
    dialog.open.mockReset();
    dialog.save.mockReset();
    paths.documentDir.mockReset();
    paths.homeDir.mockReset();
    paths.resolve.mockReset();

    api.dbListRecent.mockResolvedValue([]);
    api.dbCheckExists.mockResolvedValue(true);
    api.dbCreate.mockResolvedValue({ path: "/tmp/new.db" });
    api.dbUnlock.mockResolvedValue({ path: "/tmp/ledger.db" });
    api.dbPing.mockResolvedValue(true);
    api.dbLock.mockResolvedValue(undefined);
    api.dbRemoveRecent.mockResolvedValue(undefined);
    paths.documentDir.mockResolvedValue("/home/sam/Documents");
    paths.homeDir.mockResolvedValue("/home/sam");
    paths.resolve.mockImplementation((...parts: string[]) =>
      Promise.resolve(parts.join("/")),
    );
    dialog.save.mockResolvedValue("/tmp/new.db");
    dialog.open.mockResolvedValue("/tmp/ledger.db");

    useDbStore.setState({
      isUnlocked: false,
      recentDbs: [],
      currentDbPath: null,
      isFreshDb: false,
    });
  });

  it("asks for the recent ledgers on mount", async () => {
    renderWithProviders(<UnlockPage />);

    await waitFor(() => expect(api.dbListRecent).toHaveBeenCalled());
  });

  it("offers the ledger picker to open", async () => {
    renderWithProviders(<UnlockPage />);

    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });

  it("creates a ledger after a path was chosen", async () => {
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("创建新账本"));

    await waitFor(() =>
      expect(dialog.save).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: "/home/sam/Documents/glimmerx.db",
        }),
      ),
    );
    expect(await screen.findByText("创建账本")).toBeInTheDocument();
    expect(screen.getByText("请牢记你的密码")).toBeInTheDocument();
    expect(screen.getByText(/无法找回/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("设置加密密码")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("再次输入密码")).toBeInTheDocument();
  });

  it("falls back to the home folder when the documents folder is unknown", async () => {
    paths.documentDir.mockRejectedValue(new Error("no documents"));
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("创建新账本"));

    await waitFor(() =>
      expect(dialog.save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: "/home/sam/glimmerx.db" }),
      ),
    );
  });

  it("keeps the default filename when no folder can be found", async () => {
    paths.documentDir.mockRejectedValue(new Error("no documents"));
    paths.homeDir.mockRejectedValue(new Error("no home"));
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("创建新账本"));

    await waitFor(() =>
      expect(dialog.save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: "glimmerx.db" }),
      ),
    );
  });

  it("leaves the form alone when no path was chosen", async () => {
    dialog.save.mockResolvedValue(null);
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("创建新账本"));

    await waitFor(() => expect(dialog.save).toHaveBeenCalled());
    expect(screen.queryByText("创建账本")).toBeNull();
  });

  it("opens an existing ledger", async () => {
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("打开已有账本"));

    await waitFor(() => expect(dialog.open).toHaveBeenCalled());
    expect((await screen.findAllByText("输入密码解锁")).length).toBeGreaterThan(
      0,
    );

    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "输入密码解锁" }));

    await waitFor(() =>
      expect(api.dbUnlock).toHaveBeenCalledWith("/tmp/ledger.db", "secret"),
    );
    expect(api.dbPing).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("账本解锁成功");
    expect(useDbStore.getState().isUnlocked).toBe(true);
  });

  it("says so when the chosen file is gone", async () => {
    api.dbCheckExists.mockResolvedValue(false);
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("打开已有账本"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("该文件不存在"),
    );
  });

  it("creates the ledger with the password it was given", async () => {
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("创建新账本"));
    await screen.findByText("创建账本");

    typePassword("secret");
    fireEvent.change(
      document.querySelector("#confirmPassword") as HTMLInputElement,
      { target: { value: "secret" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(api.dbCreate).toHaveBeenCalledWith("/tmp/new.db", "secret"),
    );
    expect(toast.success).toHaveBeenCalledWith("账本创建成功");
    expect(useDbStore.getState().isFreshDb).toBe(true);
  });

  it("refuses a password that is too short", async () => {
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("创建新账本"));
    await screen.findByText("创建账本");

    typePassword("ab");
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(screen.getByText("密码至少需要 3 个字符")).toBeInTheDocument(),
    );
    expect(api.dbCreate).not.toHaveBeenCalled();
  });

  it("refuses two passwords that differ", async () => {
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("创建新账本"));
    await screen.findByText("创建账本");

    typePassword("secret");
    fireEvent.change(
      document.querySelector("#confirmPassword") as HTMLInputElement,
      { target: { value: "other" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(screen.getByText("两次密码不一致")).toBeInTheDocument(),
    );
    expect(api.dbCreate).not.toHaveBeenCalled();
  });

  it("closes the ledger it had open before switching", async () => {
    useDbStore.setState({ isUnlocked: true, currentDbPath: "/tmp/old.db" });
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("打开已有账本"));
    await screen.findAllByText("输入密码解锁");

    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "输入密码解锁" }));

    await waitFor(() => expect(api.dbLock).toHaveBeenCalled());
  });

  it("reports a failed unlock", async () => {
    api.dbUnlock.mockRejectedValue(new Error("密码错误"));
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("打开已有账本"));
    await screen.findAllByText("输入密码解锁");

    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "输入密码解锁" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("密码错误"));
    expect(useDbStore.getState().isUnlocked).toBe(false);
  });

  it("lists the ledgers opened before", async () => {
    api.dbListRecent.mockResolvedValue(RECENT);
    useDbStore.setState({ recentDbs: RECENT });
    renderWithProviders(<UnlockPage />);

    expect(await screen.findByText("最近打开")).toBeInTheDocument();
    expect(screen.getByText("ledger.db")).toBeInTheDocument();
    expect(screen.getByText("gone.db")).toBeInTheDocument();
  });

  it("removes a ledger that is gone from the recent list", async () => {
    const stale = [
      { ...RECENT[0]!, path: "/home/sam/stale.db", label: "stale.db" },
    ];
    api.dbListRecent.mockResolvedValue(stale);
    useDbStore.setState({ recentDbs: stale });
    api.dbCheckExists.mockResolvedValue(false);
    renderWithProviders(<UnlockPage />);

    fireEvent.click(await screen.findByText("stale.db"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "该账本文件已不存在，已从列表中移除",
      ),
    );
    expect(api.dbRemoveRecent).toHaveBeenCalledWith("/home/sam/stale.db");
  });

  it("removes a ledger from the list on request", async () => {
    api.dbListRecent.mockResolvedValue(RECENT);
    useDbStore.setState({ recentDbs: RECENT });
    renderWithProviders(<UnlockPage />);

    const remove = document.querySelectorAll(
      "button.text-destructive",
    )[0] as HTMLElement;
    fireEvent.click(remove);

    await waitFor(() =>
      expect(api.dbRemoveRecent).toHaveBeenCalledWith("/home/sam/ledger.db"),
    );
    expect(toast.success).toHaveBeenCalledWith("已从最近列表中移除");
  });

  it("goes back to the picker", async () => {
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("打开已有账本"));
    await screen.findAllByText("输入密码解锁");

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(await screen.findByText("创建新账本")).toBeInTheDocument();
  });

  it("leaves the form alone when no file was picked", async () => {
    dialog.open.mockResolvedValue(null);
    renderWithProviders(<UnlockPage />);
    fireEvent.click(await screen.findByText("打开已有账本"));

    await waitFor(() => expect(dialog.open).toHaveBeenCalled());
    expect(screen.queryByText("输入密码解锁")).toBeNull();
  });

  it("opens a ledger from the recent list", async () => {
    api.dbListRecent.mockResolvedValue(RECENT);
    useDbStore.setState({ recentDbs: RECENT });
    renderWithProviders(<UnlockPage />);

    fireEvent.click(await screen.findByText("ledger.db"));

    expect((await screen.findAllByText("输入密码解锁")).length).toBeGreaterThan(
      0,
    );
  });
});
