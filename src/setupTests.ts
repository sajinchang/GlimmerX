import { vi } from "vitest";
import "@testing-library/jest-dom";
import {
  cloneElement,
  createElement,
  Fragment,
  type ReactElement,
} from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh.json";

// Mock scrollIntoView (not available in jsdom, needed by Radix UI)
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn();

// jsdom implements PointerEvent but not the pointer-capture methods. Radix's
// select and slider read them on the pointer lifecycle, and a select that
// throws never opens — so the whole control would be untestable.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

// jsdom has no ResizeObserver, and Radix's switch measures its thumb with it.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// jsdom has no canvas implementation: asking for a 2D context prints a
// "not implemented" notice and returns null. Stub it, so the colour probe in
// `utils/chartColors` finds no context (and falls back) without noise.
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;

// Mock localStorage with proper storage functionality
const localStorageStore: Record<string, string> = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (key: string) => localStorageStore[key] ?? null,
    setItem: (key: string, value: string) => {
      localStorageStore[key] = value;
    },
    removeItem: (key: string) => {
      delete localStorageStore[key];
    },
    clear: () => {
      for (const key of Object.keys(localStorageStore)) {
        delete localStorageStore[key];
      }
    },
  },
  writable: true,
});

// Mock navigator.language
Object.defineProperty(window.navigator, "language", {
  value: "zh-CN",
  writable: true,
});

// Mock window.matchMedia (not available in jsdom, needed by themeStore)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

// Global mock for react-i18next - provides complete interface.
//
// `t` must keep a stable identity across renders: pages memoize header
// actions on it and push them into a provider, so a new `t` per render turns
// that effect into an update loop.
const translate = (key: string, options?: Record<string, unknown>) => {
  const keys = key.split(".");
  let value: unknown = zh;
  for (const k of keys) {
    value = (value as Record<string, unknown>)?.[k];
  }
  if (typeof value === "string") {
    if (options) {
      return Object.entries(options).reduce(
        (str, [k, v]) => str.replace(new RegExp(`{{${k}}}`, "g"), String(v)),
        value,
      );
    }
    return value;
  }
  return key;
};

const i18nStub = {
  language: "zh",
  changeLanguage: vi.fn(),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
    i18n: i18nStub,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  /**
   * `<Trans>` is the other half of the i18n API and a page may use it for a
   * sentence with markup in it. The mock keeps the markup: the numbered tags
   * are replaced by the components the caller passed in.
   */
  Trans: ({
    i18nKey,
    components,
  }: {
    i18nKey: string;
    components?: Record<string, ReactElement>;
  }) => {
    const parts = translate(i18nKey)
      .split(/(<\d+>[\s\S]*?<\/\d+>)/g)
      .filter(Boolean);
    return createElement(
      Fragment,
      null,
      ...parts.map((part) => {
        const match = /^<(\d+)>([\s\S]*?)<\/\1>$/.exec(part);
        const component = match ? components?.[match[1] as string] : undefined;
        if (!match || !component) return part;
        return cloneElement(component, {}, match[2]);
      }),
    );
  },
}));

// Initialize i18n for tests
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: "zh",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});
