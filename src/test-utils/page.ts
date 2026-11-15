// Helpers for tests that depend on the page the DOM environment pretends to
// be: its address and its measured width.

interface IHappyDomWindow {
  happyDOM: {
    setURL: (url: string) => void;
    setWindowSize: (size: { width: number; height: number }) => void;
  };
}

const happyDOM = () => (window as unknown as IHappyDomWindow).happyDOM;

// Makes the page behave as if it was loaded from the given address.
export function setPageUrl(url: string) {
  happyDOM().setURL(url);
}

// The test DOM has no layout. Components that measure their container, or the
// window, to pick between a wide and a narrow arrangement read this width
// instead; call resetPageWidth in teardown.
export function setPageWidth(width: number) {
  happyDOM().setWindowSize({ width, height: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
}

export function resetPageWidth() {
  happyDOM().setWindowSize({ width: 1024, height: 768 });
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
}
