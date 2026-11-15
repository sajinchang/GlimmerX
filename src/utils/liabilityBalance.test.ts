import { describe, it, expect } from "vitest";
import {
  getLiabilityDisplayBalance,
  getLiabilityStatusKey,
  liabilityDisplayToStorage,
  liabilityStorageToDisplay,
} from "@/utils/liabilityBalance";

describe("liability display helpers", () => {
  it("inverts the sign only for liability accounts", () => {
    expect(getLiabilityDisplayBalance(-700000, "liability")).toBe(700000);
    expect(getLiabilityDisplayBalance(100000, "liability")).toBe(-100000);
    expect(getLiabilityDisplayBalance(-700000, "asset")).toBe(-700000);
  });

  it("maps the display balance to a status key", () => {
    expect(getLiabilityStatusKey(1)).toBe("accounts.liabilityStatus.owed");
    expect(getLiabilityStatusKey(-1)).toBe("accounts.liabilityStatus.surplus");
    expect(getLiabilityStatusKey(0)).toBe("accounts.liabilityStatus.cleared");
  });

  it("converts display values back to storage values", () => {
    expect(liabilityDisplayToStorage(700000, "liability")).toBe(-700000);
    expect(liabilityDisplayToStorage(-100000, "liability")).toBe(100000);
    expect(liabilityDisplayToStorage(700000, "asset")).toBe(700000);
  });

  it("round-trips storage → display for both account kinds", () => {
    expect(liabilityStorageToDisplay(-700000, "liability")).toBe(700000);
    expect(liabilityStorageToDisplay(700000, "asset")).toBe(700000);
  });
});
