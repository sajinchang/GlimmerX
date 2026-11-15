import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { renderWithProviders } from "@/test-utils/render";

const { api } = vi.hoisted(() => ({
  api: { dbChangePassword: vi.fn() },
}));

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  return { ...actual, ...api };
});

const { session } = vi.hoisted(() => ({
  session: { lockSession: vi.fn() },
}));

vi.mock("@/utils/session", () => ({
  lockSession: session.lockSession,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

import { toast } from "sonner";

function fill(id: string, value: string) {
  fireEvent.change(document.querySelector(`#${id}`) as HTMLInputElement, {
    target: { value },
  });
}

describe("ChangePasswordDialog", () => {
  beforeEach(() => {
    api.dbChangePassword.mockReset();
    session.lockSession.mockReset();
    api.dbChangePassword.mockResolvedValue(undefined);
    session.lockSession.mockResolvedValue(true);
  });

  it("asks for the old and the new password", async () => {
    renderWithProviders(<ChangePasswordDialog open onOpenChange={vi.fn()} />);

    expect((await screen.findAllByText("修改密码")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("当前密码")).toBeInTheDocument();
    expect(screen.getByLabelText("新密码")).toBeInTheDocument();
    expect(screen.getByLabelText("确认新密码")).toBeInTheDocument();
  });

  it("changes the password and locks the ledger again", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ChangePasswordDialog open onOpenChange={onOpenChange} />,
    );
    await screen.findAllByText("修改密码");

    fill("oldPassword", "old-secret");
    fill("newPassword", "new-secret");
    fill("confirmNewPassword", "new-secret");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() =>
      expect(api.dbChangePassword).toHaveBeenCalledWith(
        "old-secret",
        "new-secret",
      ),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "密码修改成功。请使用新密码重新解锁。",
    );
    expect(session.lockSession).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks for the fields that are missing", async () => {
    renderWithProviders(<ChangePasswordDialog open onOpenChange={vi.fn()} />);
    await screen.findAllByText("修改密码");

    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() =>
      expect(screen.getAllByText("密码不能为空").length).toBeGreaterThan(0),
    );
    expect(api.dbChangePassword).not.toHaveBeenCalled();
  });

  it("refuses a new password that is too short", async () => {
    renderWithProviders(<ChangePasswordDialog open onOpenChange={vi.fn()} />);
    await screen.findAllByText("修改密码");

    fill("oldPassword", "old-secret");
    fill("newPassword", "ab");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() =>
      expect(screen.getByText("密码至少需要 3 个字符")).toBeInTheDocument(),
    );
  });

  it("refuses two new passwords that differ", async () => {
    renderWithProviders(<ChangePasswordDialog open onOpenChange={vi.fn()} />);
    await screen.findAllByText("修改密码");

    fill("oldPassword", "old-secret");
    fill("newPassword", "new-secret");
    fill("confirmNewPassword", "other-secret");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() =>
      expect(screen.getByText("两次密码不一致")).toBeInTheDocument(),
    );
    expect(api.dbChangePassword).not.toHaveBeenCalled();
  });

  it("reports a password that could not be changed", async () => {
    api.dbChangePassword.mockRejectedValue(new Error("改不了"));
    renderWithProviders(<ChangePasswordDialog open onOpenChange={vi.fn()} />);
    await screen.findAllByText("修改密码");

    fill("oldPassword", "old-secret");
    fill("newPassword", "new-secret");
    fill("confirmNewPassword", "new-secret");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("改不了"));
  });

  it("says so when the ledger could not be locked", async () => {
    session.lockSession.mockResolvedValue(false);
    renderWithProviders(<ChangePasswordDialog open onOpenChange={vi.fn()} />);
    await screen.findAllByText("修改密码");

    fill("oldPassword", "old-secret");
    fill("newPassword", "new-secret");
    fill("confirmNewPassword", "new-secret");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("closes without changing anything", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ChangePasswordDialog open onOpenChange={onOpenChange} />,
    );
    await screen.findAllByText("修改密码");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.dbChangePassword).not.toHaveBeenCalled();
  });
});
