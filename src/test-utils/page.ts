// Helpers for tests that depend on the page the DOM environment pretends to
// be: its address and its measured width.

interface IHappyDomWindow {
  happyDOM: { setURL: (url: string) => void };
}

// Makes the page behave as if it was loaded from the given address.
export function setPageUrl(url: string) {
  (window as unknown as IHappyDomWindow).happyDOM.setURL(url);
}

// The test DOM has no layout. Components that measure their container to pick
// between a wide and a narrow arrangement read this width instead; call
// resetPageWidth in teardown.
export function setPageWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
}

export function resetPageWidth() {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
}
