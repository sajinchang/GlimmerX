import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SavingsPage } from "@/pages/SavingsPage";
import { renderWithProviders } from "@/test-utils/render";
import { clickOption, openSelect } from "@/test-utils/radix";

const { api } = vi.hoisted(() => ({
  api: {
    savingsList: vi.fn(),
    savingsCreate: vi.fn(),
    savingsUpdate: vi.fn(),
    savingsDelete: vi.fn(),
    savingsSetStatus: vi.fn(),
    accountTransfer: vi.fn(),
    accountList: vi.fn(),
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

import { toast } from "sonner";

const GOAL = {
  id: "g1",
  name: "旅行",
  accountId: "acc-goal",
  targetAmount: 1000000,
  savedAmount: 250000,
  remaining: 750000,
  monthlyNeeded: 50000,
  targetDate: "2026-12-01",
  monthlyPlan: 50000,
  status: "active",
};

const ACCOUNTS = [
  { id: "acc1", name: "现金", account_type: "asset", is_active: true },
  { id: "acc-goal", name: "旅行", account_type: "asset", is_active: true },
];

describe("SavingsPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.savingsList.mockResolvedValue([GOAL]);
    api.savingsCreate.mockResolvedValue(GOAL);
    api.savingsUpdate.mockResolvedValue(GOAL);
    api.savingsDelete.mockResolvedValue(undefined);
    api.savingsSetStatus.mockResolvedValue(undefined);
    api.accountTransfer.mockResolvedValue(undefined);
    api.accountList.mockResolvedValue(ACCOUNTS);
  });

  it("lists the goals", async () => {
    renderWithProviders(<SavingsPage />);

    expect(await screen.findByText("旅行")).toBeInTheDocument();
    expect(screen.getByText("¥2,500.00")).toBeInTheDocument();
    expect(screen.getByText("¥10,000.00")).toBeInTheDocument();
  });

  it("says so when there is no goal", async () => {
    api.savingsList.mockResolvedValue([]);
    renderWithProviders(<SavingsPage />);

    expect(await screen.findByText("还没有储蓄目标")).toBeInTheDocument();
  });

  it("creates a goal", async () => {
    renderWithProviders(<SavingsPage />, { withHeaderActions: true });
    await screen.findByText("旅行");

    fireEvent.click(
      screen
        .getByTestId("header-actions")
        .querySelector("button") as HTMLElement,
    );
    expect((await screen.findAllByText("新建目标")).length).toBeGreaterThan(0);

    fireEvent.change(document.querySelector("#goal-name") as HTMLInputElement, {
      target: { value: "买房" },
    });
    fireEvent.change(
      document.querySelector("#goal-target") as HTMLInputElement,
      {
        target: { value: "10000" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.savingsCreate).toHaveBeenCalledWith({
        name: "买房",
        targetAmount: "10000",
        targetDate: null,
        monthlyPlan: null,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("目标已创建");
  });

  it("edits a goal", async () => {
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(await screen.findByText("编辑目标")).toBeInTheDocument();

    fireEvent.change(document.querySelector("#goal-name") as HTMLInputElement, {
      target: { value: "旅行基金" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.savingsUpdate).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({ name: "旅行基金" }),
      ),
    );
  });

  it("puts money into the goal", async () => {
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "存入" }));
    expect(await screen.findByText(/存入 ·/)).toBeInTheDocument();

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("现金");
    fireEvent.change(
      document.querySelector("#transfer-amount") as HTMLInputElement,
      { target: { value: "100.00" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.accountTransfer).toHaveBeenCalledWith(
        "acc1",
        "acc-goal",
        10000,
        expect.any(String),
      ),
    );
  });

  it("takes money out of the goal", async () => {
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "取出" }));
    expect(await screen.findByText(/取出 ·/)).toBeInTheDocument();

    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("现金");
    fireEvent.change(
      document.querySelector("#transfer-amount") as HTMLInputElement,
      { target: { value: "100.00" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.accountTransfer).toHaveBeenCalledWith(
        "acc-goal",
        "acc1",
        10000,
        expect.any(String),
      ),
    );
  });

  it("refuses an amount that is not money", async () => {
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "存入" }));
    const triggers = await screen.findAllByRole("combobox");
    await openSelect(triggers[0] as HTMLElement);
    clickOption("现金");
    fireEvent.change(
      document.querySelector("#transfer-amount") as HTMLInputElement,
      { target: { value: "0" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(toast.error).toHaveBeenCalled();
    expect(api.accountTransfer).not.toHaveBeenCalled();
  });

  it("archives a goal and brings it back", async () => {
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    await waitFor(() =>
      expect(api.savingsSetStatus).toHaveBeenCalledWith("g1", "archived"),
    );
  });

  it("deletes a goal", async () => {
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(api.savingsDelete).toHaveBeenCalledWith("g1"));
    expect(toast.success).toHaveBeenCalledWith("目标已删除");
  });

  it("reports a goal it could not delete", async () => {
    api.savingsDelete.mockRejectedValue(new Error("删不了"));
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("删不了"));
  });

  it("says so when the goal is already reached", async () => {
    api.savingsList.mockResolvedValue([
      { ...GOAL, status: "achieved", savedAmount: 1000000, remaining: 0 },
    ]);
    renderWithProviders(<SavingsPage />);

    expect(await screen.findByText("已达成")).toBeInTheDocument();
  });

  it("brings an archived goal back", async () => {
    api.savingsList.mockResolvedValue([
      { ...GOAL, status: "archived", monthlyNeeded: null },
    ]);
    renderWithProviders(<SavingsPage />);

    expect(await screen.findByText("已归档")).toBeInTheDocument();
    expect(screen.queryByText(/每月需要/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    await waitFor(() =>
      expect(api.savingsSetStatus).toHaveBeenCalledWith("g1", "active"),
    );
  });

  it("shows a goal without a target", async () => {
    api.savingsList.mockResolvedValue([
      {
        ...GOAL,
        targetAmount: 0,
        savedAmount: 0,
        remaining: 0,
        monthlyNeeded: null,
      },
    ]);
    renderWithProviders(<SavingsPage />);

    expect(await screen.findByText("旅行")).toBeInTheDocument();
    const bar = document.querySelector(".h-2 > div") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("keeps the monthly plan of a goal", async () => {
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await screen.findByText("编辑目标");

    fireEvent.change(document.querySelector("#goal-plan") as HTMLInputElement, {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.savingsUpdate).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({
          monthlyPlan: "500",
          targetDate: "2026-12-01",
        }),
      ),
    );
  });

  it("will not transfer without an account", async () => {
    renderWithProviders(<SavingsPage />);
    await screen.findByText("旅行");

    fireEvent.click(screen.getByRole("button", { name: "存入" }));
    await screen.findByText(/存入 ·/);

    fireEvent.change(
      document.querySelector("#transfer-amount") as HTMLInputElement,
      { target: { value: "10" } },
    );

    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(api.accountTransfer).not.toHaveBeenCalled();
  });
});
