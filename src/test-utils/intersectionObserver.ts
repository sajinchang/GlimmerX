/**
 * jsdom has no IntersectionObserver, and the infinite list needs one to ask for
 * the next page. The stub records every observer so a test can say "the
 * sentinel is on screen" and watch what the list does.
 */
type Trigger = (isIntersecting: boolean) => void;

const triggers: Trigger[] = [];

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(private readonly callback: IntersectionObserverCallback) {
    triggers.push((isIntersecting) => {
      this.callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    });
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver =
  FakeIntersectionObserver as unknown as typeof IntersectionObserver;

/** Tell every observer that its target is (or is no longer) on screen. */
export function triggerIntersection(isIntersecting = true) {
  for (const trigger of triggers) trigger(isIntersecting);
}
