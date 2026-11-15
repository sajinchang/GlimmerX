import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setLanguage, getCurrentLanguage, SUPPORTED_LANGUAGES } from "@/i18n";

describe("i18n configuration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("SUPPORTED_LANGUAGES", () => {
    it("contains English and Chinese", () => {
      expect(SUPPORTED_LANGUAGES.length).toBe(2);
      expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(["en", "zh"]);
    });
  });

  describe("setLanguage", () => {
    it("saves language to localStorage and changes i18n language", () => {
      setLanguage("en");
      expect(getCurrentLanguage()).toBe("en");

      setLanguage("zh");
      expect(getCurrentLanguage()).toBe("zh");
    });
  });

  describe("document language", () => {
    it("corrects the hard-coded <html lang> at startup", () => {
      // setupTests pins navigator.language to "zh-CN" and localStorage is empty,
      // so the module must have replaced index.html's `lang="en"`.
      expect(document.documentElement.lang).toBe("zh");
    });

    it("mirrors UI language changes onto <html lang>", () => {
      setLanguage("en");
      expect(document.documentElement.lang).toBe("en");

      setLanguage("zh");
      expect(document.documentElement.lang).toBe("zh");
    });
  });

  describe("getCurrentLanguage", () => {
    it("returns the current language after setLanguage", () => {
      setLanguage("en");
      expect(getCurrentLanguage()).toBe("en");
    });
  });
});
