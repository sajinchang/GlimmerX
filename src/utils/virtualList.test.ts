import { describe, it, expect } from "vitest";
import { flattenToVirtualItems } from "@/utils/virtualList";
import type { TransactionDateGroup } from "@/types";

function group(
  date: string,
  ids: string[],
  dayTotal = 0,
): TransactionDateGroup {
  return {
    date,
    dayTotal,
    items: ids.map((id) => ({ id }) as never),
  } as unknown as TransactionDateGroup;
}

describe("flattenToVirtualItems", () => {
  it("returns nothing for an empty list", () => {
    expect(flattenToVirtualItems([])).toEqual([]);
  });

  it("emits a header before each group's rows and keeps order", () => {
    const items = flattenToVirtualItems([
      group("2026-11-15", ["a", "b"], -1200),
      group("2026-11-14", ["c"]),
    ]);

    expect(items.map((item) => item.type)).toEqual([
      "date-header",
      "transaction",
      "transaction",
      "date-header",
      "transaction",
    ]);
    expect(items[0]).toEqual({
      type: "date-header",
      date: "2026-11-15",
      dayTotal: -1200,
      isFirst: true,
    });
    expect(items[1]).toEqual({
      type: "transaction",
      data: { id: "a" },
      date: "2026-11-15",
    });
    expect(items[3]).toMatchObject({ date: "2026-11-14", isFirst: false });
  });

  it("keeps a header for a group with no rows", () => {
    const items = flattenToVirtualItems([group("2026-11-15", [])]);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("date-header");
  });
});
