import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { IconPicker } from "@/components/categories/IconPicker";
import { CategoryForm } from "@/components/categories/CategoryForm";
import { renderWithProviders } from "@/test-utils/render";
import type { Category } from "@/types";

describe("IconPicker", () => {
  it("asks for an icon when there is none", () => {
    renderWithProviders(<IconPicker value="" onChange={vi.fn()} />);

    expect(screen.getByText("选择图标")).toBeInTheDocument();
  });

  it("shows the icon it holds", () => {
    renderWithProviders(<IconPicker value="🍚" onChange={vi.fn()} />);

    expect(screen.getByText("🍚")).toBeInTheDocument();
  });

  it("picks an icon", () => {
    const onChange = vi.fn();
    renderWithProviders(<IconPicker value="" onChange={onChange} />);

    fireEvent.click(screen.getByText("选择图标"));
    fireEvent.click(screen.getByRole("button", { name: "🍕" }));

    expect(onChange).toHaveBeenCalledWith("🍕");
  });

  it("takes the icon away again", () => {
    const onChange = vi.fn();
    renderWithProviders(<IconPicker value="🍚" onChange={onChange} />);

    fireEvent.click(screen.getByText("🍚"));
    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("cannot be opened when it is disabled", () => {
    renderWithProviders(<IconPicker value="" onChange={vi.fn()} disabled />);

    expect(screen.getByText("选择图标").closest("button")).toBeDisabled();
  });
});

describe("CategoryForm", () => {
  const category: Category = {
    id: "c1",
    name: "餐饮",
    type: "expense",
    icon: "🍚",
    accountId: "acc1",
    balance: 0,
    createdAt: "2026-01-01T00:00:00+08:00",
    updatedAt: "2026-01-01T00:00:00+08:00",
  };

  it("asks for a name before it saves", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <CategoryForm
        open
        onOpenChange={vi.fn()}
        mode="create"
        onSubmit={onSubmit}
      />,
    );

    expect(await screen.findByText("新建分类")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();

    fireEvent.change(
      document.querySelector("#category-name") as HTMLInputElement,
      {
        target: { value: "购物" },
      },
    );
    expect(save).toBeEnabled();
  });

  it("fills the form from the category it edits", async () => {
    renderWithProviders(
      <CategoryForm
        open
        onOpenChange={vi.fn()}
        mode="edit"
        category={category}
        onSubmit={vi.fn()}
      />,
    );

    expect(await screen.findByText("编辑分类")).toBeInTheDocument();
    expect(
      (document.querySelector("#category-name") as HTMLInputElement).value,
    ).toBe("餐饮");
  });

  it("does not ask for the type when it edits", async () => {
    renderWithProviders(
      <CategoryForm
        open
        onOpenChange={vi.fn()}
        mode="edit"
        category={category}
        onSubmit={vi.fn()}
      />,
    );

    await screen.findByText("编辑分类");
    expect(screen.queryByLabelText("类型")).toBeNull();
  });

  it("closes without saving", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <CategoryForm
        open
        onOpenChange={onOpenChange}
        mode="create"
        onSubmit={vi.fn()}
      />,
    );

    await screen.findByText("新建分类");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
