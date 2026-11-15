import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "@/stores/uiStore";

beforeEach(() => {
  useUiStore.setState({ quickAddOpen: false });
});

describe("useUiStore", () => {
  it("opens and closes the quick-add dialog", () => {
    useUiStore.getState().setQuickAddOpen(true);
    expect(useUiStore.getState().quickAddOpen).toBe(true);

    useUiStore.getState().closeQuickAdd();
    expect(useUiStore.getState().quickAddOpen).toBe(false);
  });

  it("treats closeQuickAdd as idempotent", () => {
    useUiStore.getState().closeQuickAdd();
    useUiStore.getState().closeQuickAdd();
    expect(useUiStore.getState().quickAddOpen).toBe(false);
  });
});
