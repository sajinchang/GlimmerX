import { fireEvent, screen } from "@testing-library/react";

/**
 * Radix opens a select on a *mouse* pointer press — a plain click on the
 * trigger does nothing — and picks an item on a click. jsdom knows the pointer
 * event but not the capture methods, so the press has to name its pointer
 * type; without it the trigger silently ignores the press.
 */
export async function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  return screen.findByRole("listbox");
}

/** Click the option whose label contains `text`. */
export function clickOption(text: string) {
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((node) => node.textContent?.includes(text));
  if (!option) throw new Error(`no option labelled ${text}`);
  fireEvent.click(option);
  return option;
}
