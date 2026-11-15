import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TreeView, type TreeDataItem } from "@/components/ui/tree-view";

function makeData(): TreeDataItem[] {
  return [
    {
      id: "root",
      name: "根节点",
      children: [
        { id: "child", name: "子节点" },
        { id: "locked", name: "禁用节点", disabled: true },
      ],
    },
    { id: "leaf", name: "叶子节点", draggable: true },
  ];
}

describe("TreeView", () => {
  it("renders the top level rows", () => {
    render(<TreeView data={makeData()} />);

    expect(screen.getByText("根节点")).toBeInTheDocument();
    expect(screen.getByText("叶子节点")).toBeInTheDocument();
  });

  it("expands a node to show its children", () => {
    render(<TreeView data={makeData()} />);

    // Radix keeps closed accordion content unmounted.
    expect(screen.queryByText("子节点")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("根节点"));
    expect(screen.getByText("子节点")).toBeInTheDocument();
  });

  it("reports the selected leaf", () => {
    const onSelectChange = vi.fn();
    render(<TreeView data={makeData()} onSelectChange={onSelectChange} />);

    fireEvent.click(screen.getByText("叶子节点"));

    expect(onSelectChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "leaf", name: "叶子节点" }),
    );
  });

  it("calls the item's own click handler as well", () => {
    const onClick = vi.fn();
    const data: TreeDataItem[] = [{ id: "leaf", name: "叶子节点", onClick }];
    render(<TreeView data={data} />);

    fireEvent.click(screen.getByText("叶子节点"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks on a disabled row", () => {
    const onSelectChange = vi.fn();
    const data: TreeDataItem[] = [
      { id: "locked", name: "禁用节点", disabled: true },
    ];
    render(<TreeView data={data} onSelectChange={onSelectChange} />);

    fireEvent.click(screen.getByText("禁用节点"));

    expect(onSelectChange).not.toHaveBeenCalled();
  });

  it("renders a single item that is not an array", () => {
    render(<TreeView data={{ id: "one", name: "单个节点" }} />);

    expect(screen.getByText("单个节点")).toBeInTheDocument();
  });

  it("uses the custom renderer when one is given", () => {
    render(
      <TreeView
        data={[{ id: "leaf", name: "叶子节点" }]}
        renderItem={({ item, isLeaf }) => (
          <span data-testid={`custom-${String(item.id)}`}>
            {isLeaf ? "leaf:" : "node:"}
            {String(item.name)}
          </span>
        )}
      />,
    );

    expect(screen.getByTestId("custom-leaf")).toHaveTextContent(
      "leaf:叶子节点",
    );
  });

  it("reports a drag from one row onto another", () => {
    const onDocumentDrag = vi.fn();
    render(
      <TreeView
        data={[
          { id: "a", name: "A", draggable: true },
          { id: "b", name: "B" },
        ]}
        onDocumentDrag={onDocumentDrag}
      />,
    );

    const source = screen.getByText("A");
    const target = screen.getByText("B");

    fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(onDocumentDrag).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ id: "b" }),
    );
  });

  it("does not start a drag for a row that is not draggable", () => {
    const setData = vi.fn();
    render(<TreeView data={[{ id: "a", name: "A" }]} />);

    fireEvent.dragStart(screen.getByText("A"), { dataTransfer: { setData } });

    expect(setData).not.toHaveBeenCalled();
  });

  it("drags a node onto another node", () => {
    const onDocumentDrag = vi.fn();
    render(
      <TreeView
        data={[
          {
            id: "a",
            name: "A",
            draggable: true,
            children: [{ id: "a1", name: "A1" }],
          },
          { id: "b", name: "B", draggable: true },
        ]}
        onDocumentDrag={onDocumentDrag}
      />,
    );

    fireEvent.dragStart(screen.getByText("A"), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.dragOver(screen.getByText("B"));
    fireEvent.drop(screen.getByText("B"));

    expect(onDocumentDrag).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ id: "b" }),
    );
  });

  it("does not report a row dropped onto itself", () => {
    const onDocumentDrag = vi.fn();
    render(
      <TreeView
        data={[{ id: "a", name: "A", draggable: true }]}
        onDocumentDrag={onDocumentDrag}
      />,
    );

    fireEvent.dragStart(screen.getByText("A"), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.dragOver(screen.getByText("A"));
    fireEvent.drop(screen.getByText("A"));

    expect(onDocumentDrag).not.toHaveBeenCalled();
  });

  it("marks the row a card is dragged over as a drop target", () => {
    render(
      <TreeView
        data={[
          { id: "a", name: "A", draggable: true },
          { id: "b", name: "B" },
        ]}
      />,
    );

    fireEvent.dragStart(screen.getByText("A"), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.dragOver(screen.getByText("B"));

    const row = screen.getByText("B").closest("div.ml-5");
    expect(row?.className).toContain("text-primary-foreground");

    fireEvent.dragLeave(screen.getByText("B"));
    expect(row?.className).not.toContain("text-primary-foreground");
  });

  it("does not offer a row that cannot be dropped on", () => {
    render(
      <TreeView
        data={[
          { id: "a", name: "A", draggable: true },
          { id: "b", name: "B", droppable: false },
        ]}
      />,
    );

    fireEvent.dragStart(screen.getByText("A"), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.dragOver(screen.getByText("B"));

    const row = screen.getByText("B").closest("div.ml-5");
    expect(row?.className).not.toContain("text-primary-foreground");
  });

  it("does not start a drag for a disabled row", () => {
    const setData = vi.fn();
    render(
      <TreeView
        data={[{ id: "a", name: "A", draggable: true, disabled: true }]}
      />,
    );

    fireEvent.dragStart(screen.getByText("A"), { dataTransfer: { setData } });

    expect(setData).not.toHaveBeenCalled();
  });

  it("does not drop onto a disabled row", () => {
    const onDocumentDrag = vi.fn();
    render(
      <TreeView
        data={[
          { id: "a", name: "A", draggable: true },
          { id: "b", name: "B", disabled: true },
        ]}
        onDocumentDrag={onDocumentDrag}
      />,
    );

    fireEvent.dragStart(screen.getByText("A"), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.dragOver(screen.getByText("B"));
    fireEvent.drop(screen.getByText("B"));

    expect(onDocumentDrag).not.toHaveBeenCalled();
  });

  it("opens the branch that holds the selected row", () => {
    render(
      <TreeView
        data={[
          {
            id: "root",
            name: "根节点",
            children: [{ id: "child", name: "子节点" }],
          },
        ]}
        initialSelectedItemId="child"
      />,
    );

    expect(screen.getByText("子节点")).toBeInTheDocument();
  });

  it("opens every branch when it is told to", () => {
    render(
      <TreeView
        data={[
          {
            id: "root",
            name: "根节点",
            children: [{ id: "child", name: "子节点" }],
          },
        ]}
        initialSelectedItemId="child"
        expandAll
      />,
    );

    expect(screen.getByText("子节点")).toBeInTheDocument();
  });

  it("marks the selected row", () => {
    render(
      <TreeView
        data={[{ id: "leaf", name: "叶子节点" }]}
        initialSelectedItemId="leaf"
      />,
    );

    expect(screen.getByText("叶子节点")).toBeInTheDocument();
  });

  it("shows the icon a row carries", () => {
    const Icon = () => <span data-testid="icon" />;
    render(<TreeView data={[{ id: "leaf", name: "叶子节点", icon: Icon }]} />);

    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("shows the icon of a row that is selected", () => {
    const Plain = () => <span data-testid="plain" />;
    const Selected = () => <span data-testid="selected" />;
    render(
      <TreeView
        data={[
          { id: "leaf", name: "叶子节点", icon: Plain, selectedIcon: Selected },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("叶子节点"));

    expect(screen.getByTestId("selected")).toBeInTheDocument();
  });

  it("shows the icon of a row that is open", () => {
    const Plain = () => <span data-testid="plain" />;
    const Open = () => <span data-testid="open" />;
    render(
      <TreeView
        data={[
          {
            id: "root",
            name: "根节点",
            icon: Plain,
            openIcon: Open,
            children: [{ id: "child", name: "子节点" }],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("根节点"));

    expect(screen.getByTestId("open")).toBeInTheDocument();
  });

  it("keeps a row that has no children yet", () => {
    render(<TreeView data={[{ id: "root", name: "根节点", children: [] }]} />);

    expect(screen.getByText("根节点")).toBeInTheDocument();
  });

  it("marks a node a card is dragged over", () => {
    render(
      <TreeView
        data={[
          {
            id: "a",
            name: "A",
            draggable: true,
            children: [{ id: "a1", name: "A1" }],
          },
          { id: "b", name: "B", draggable: true },
        ]}
      />,
    );

    fireEvent.dragStart(screen.getByText("A"), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.dragOver(screen.getByText("B"));

    const row = screen.getByText("B").closest("div.ml-5") as HTMLElement;
    expect(row.className).toContain("text-primary-foreground");

    fireEvent.dragLeave(screen.getByText("B"));
    expect(row.className).not.toContain("text-primary-foreground");
  });

  it("draws a node with the custom renderer", () => {
    render(
      <TreeView
        data={[
          {
            id: "root",
            name: "根节点",
            children: [{ id: "child", name: "子节点" }],
          },
        ]}
        renderItem={({ item, level }) => (
          <span data-testid={`custom-${String(item.id)}`}>
            {level}:{String(item.name)}
          </span>
        )}
      />,
    );

    fireEvent.click(screen.getByTestId("custom-root"));

    expect(screen.getByTestId("custom-child")).toHaveTextContent("1:子节点");
  });

  it("keeps the branch of a selected row open when everything is open", () => {
    render(
      <TreeView
        data={[
          {
            id: "root",
            name: "根节点",
            children: [{ id: "child", name: "子节点" }],
          },
        ]}
        initialSelectedItemId="child"
        expandAll
      />,
    );

    expect(screen.getByText("子节点")).toBeInTheDocument();
  });

  it("does not start a drag for a node that cannot be dragged", () => {
    const setData = vi.fn();
    render(
      <TreeView
        data={[
          {
            id: "root",
            name: "根节点",
            children: [{ id: "child", name: "子节点" }],
          },
        ]}
      />,
    );

    fireEvent.dragStart(screen.getByText("根节点"), {
      dataTransfer: { setData },
    });

    expect(setData).not.toHaveBeenCalled();
  });

  it("does not offer a node that cannot be dropped on", () => {
    render(
      <TreeView
        data={[
          {
            id: "a",
            name: "A",
            draggable: true,
            droppable: false,
            children: [{ id: "a1", name: "A1" }],
          },
          { id: "b", name: "B", draggable: true },
        ]}
      />,
    );

    fireEvent.dragStart(screen.getByText("B"), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.dragOver(screen.getByText("A"));

    const trigger = screen.getByText("A").closest("button") as HTMLElement;
    expect(trigger.className).not.toContain("text-primary-foreground");
  });
});
