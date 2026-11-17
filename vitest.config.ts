import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // The app imports both `react-router` (Link, hooks) and
      // `react-router-dom` (BrowserRouter). In tests the two entry points
      // resolve to different builds — one ESM, one CJS — so each keeps its own
      // router context and a `<Link>` inside our `MemoryRouter` sees `null`.
      // Point both at the same package.
      { find: /^react-router-dom$/, replacement: "react-router" },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    globals: true,
    // Pin the test timezone. Timestamp formatters render RFC3339 values in
    // the user's local timezone (design rule: dates are local), so an
    // expectation like "13:45" for `2026-10-26T13:45:00+08:00` only holds
    // when local time is UTC+08. CI runs in UTC, which turned that into
    // "05:45"; keep every environment on the same zone instead.
    env: { TZ: "Asia/Shanghai" },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      // Include every source file so untested pages are visible too.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/setupTests.ts",
        "src/types/**",
        "src/i18n/locales/**",
        "src/vite-env.d.ts",
      ],
      // Target: 90% on every metric. The floor is raised after each batch of
      // tests so no gain can silently regress.
      // Measured 2026-11-15 after the utils / hooks / stores / api batch and
      // the pages batch: 51.66% stmts, 52.13% lines, 47.76% funcs, 40.15%
      // branches.
      thresholds: {
        statements: 51,
        lines: 52,
        functions: 47,
        branches: 40,
      },
    },
  },
});
