import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { renderWithProviders } from "@/test-utils/render";

describe("command palette", () => {
  it("offers a list of commands", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <Command>
        <CommandInput placeholder="搜索命令" />
        <CommandList>
          <CommandEmpty>没有匹配的命令</CommandEmpty>
          <CommandGroup heading="页面">
            <CommandItem onSelect={onSelect}>交易</CommandItem>
            <CommandItem>账户</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandItem>
            设置
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandList>
      </Command>,
    );

    const input = screen.getByPlaceholderText("搜索命令");
    fireEvent.change(input, { target: { value: "交易" } });

    const item = await screen.findByText("交易");
    fireEvent.click(item);

    expect(onSelect).toHaveBeenCalled();
  });

  it("says so when nothing matches", async () => {
    renderWithProviders(
      <Command>
        <CommandInput placeholder="搜索命令" />
        <CommandList>
          <CommandEmpty>没有匹配的命令</CommandEmpty>
          <CommandGroup heading="页面">
            <CommandItem>交易</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );

    fireEvent.change(screen.getByPlaceholderText("搜索命令"), {
      target: { value: "找不到" },
    });

    expect(await screen.findByText("没有匹配的命令")).toBeInTheDocument();
  });

  it("opens in a dialog", () => {
    renderWithProviders(
      <CommandDialog open title="命令面板" description="搜索要执行的命令">
        <CommandInput placeholder="搜索命令" />
        <CommandList>
          <CommandItem>交易</CommandItem>
        </CommandList>
      </CommandDialog>,
    );

    expect(screen.getByText("命令面板")).toBeInTheDocument();
    expect(screen.getByText("搜索要执行的命令")).toBeInTheDocument();
  });
});
