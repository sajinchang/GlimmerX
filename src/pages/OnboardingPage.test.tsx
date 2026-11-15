import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { renderWithProviders } from "@/test-utils/render";

vi.mock("@/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/api")>();
  const source = actual as unknown as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...source };
  for (const key of Object.keys(source)) {
    if (typeof source[key] === "function") {
      mocked[key] = vi.fn().mockResolvedValue([]);
    }
  }
  return mocked;
});

import { OnboardingPage } from "@/pages/OnboardingPage";

function renderOnboarding() {
  return renderWithProviders(
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/" element={<div>home-probe</div>} />
      <Route path="/accounts" element={<div>accounts-probe</div>} />
    </Routes>,
    { route: "/onboarding" },
  );
}

describe("OnboardingPage", () => {
  it("greets the user and opens the account wizard immediately", async () => {
    renderOnboarding();

    expect(screen.getByText("欢迎使用 GlimmerX")).toBeInTheDocument();
    // The wizard starts open — an empty ledger cannot do anything else.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("lets the user skip into the dashboard", async () => {
    renderOnboarding();

    fireEvent.click(screen.getByText("跳过，稍后再设置"));

    await waitFor(() =>
      expect(screen.getByText("home-probe")).toBeInTheDocument(),
    );
  });

  it("can reopen the wizard after dismissing it", async () => {
    renderOnboarding();

    fireEvent.click(screen.getByText("添加第一个账户"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
