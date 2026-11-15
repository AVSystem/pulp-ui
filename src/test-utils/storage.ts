import { vi } from 'vitest';

// Makes the browser storage behave like one that blocks site data: touching
// it at all throws. Undone by vi.restoreAllMocks().
export function blockStorage() {
  const denied = () => {
    throw new DOMException('Access is denied', 'SecurityError');
  };
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(denied);
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(denied);
}
