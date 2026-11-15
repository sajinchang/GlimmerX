import { useHeaderActions } from "@/contexts/HeaderContext";

/**
 * The slot the window header would show the page's actions in.
 *
 * It lives in its own file so the harness beside it only exports a function:
 * a file that mixes a component with a helper breaks React Fast Refresh.
 */
export function HeaderActionsSlot() {
  const { actions } = useHeaderActions();
  return actions ? <div data-testid="header-actions">{actions}</div> : null;
}
