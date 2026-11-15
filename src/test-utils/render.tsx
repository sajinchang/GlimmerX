import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Import from `react-router` (not `react-router-dom`): the app's components use
// that entry point, and mixing the two packages in one test tree yields two
// copies of the router context, so `Link` renders with a null context.
import { MemoryRouter, Route, Routes } from "react-router";
import { HeaderProvider } from "@/contexts/HeaderContext";
import { HeaderActionsSlot } from "@/test-utils/HeaderActionsSlot";

/**
 * A throwaway QueryClient per render: `retry: false` so a rejected query fails
 * the assertion instead of retrying for three seconds, and `gcTime: 0` so one
 * test's cache cannot leak into the next through the module-level client.
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderOptions {
  /** Initial history entry. */
  route?: string;
  /**
   * Route pattern to mount the element on, when the component reads
   * `useParams` (e.g. `"/transactions/:id"`). Omit for plain components.
   */
  path?: string;
  /**
   * Render the actions a page hands to the window header. The real header is
   * part of the shell, not of the page, so a page test has to ask for them
   * explicitly to be able to press them.
   */
  withHeaderActions?: boolean;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/", path, withHeaderActions = false }: RenderOptions = {},
): RenderResult {
  const client = createTestQueryClient();
  const tree = path ? (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  ) : (
    ui
  );

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        {/* Pages push their header actions into this provider; without it they
            throw, so every page test would need its own wrapper. */}
        <HeaderProvider>
          {withHeaderActions ? <HeaderActionsSlot /> : null}
          {tree}
        </HeaderProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
