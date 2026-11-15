import { describe, it, expect, vi } from "vitest";
import type { TFunction } from "i18next";
import { translateErrorMessage } from "@/utils/errorTranslation";

const t = vi.fn((key: string) => key) as unknown as TFunction;

describe("translateErrorMessage", () => {
  it("returns backend strings verbatim", () => {
    expect(translateErrorMessage("余额不足", t)).toBe("余额不足");
  });

  it("unwraps Error instances without rewriting them", () => {
    expect(translateErrorMessage(new TypeError("网络不可用"), t)).toBe(
      "网络不可用",
    );
  });

  it("falls back to the generic message for unknown shapes", () => {
    expect(translateErrorMessage({ code: 42 }, t)).toBe("common.errorGeneric");
    expect(t).toHaveBeenCalledWith("common.errorGeneric");
  });

  it("does not translate null or undefined", () => {
    expect(translateErrorMessage(null, t)).toBe("common.errorGeneric");
    expect(translateErrorMessage(undefined, t)).toBe("common.errorGeneric");
  });
});
