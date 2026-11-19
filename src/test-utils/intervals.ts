import { act } from '@testing-library/react';
import { type MockInstance, vi } from 'vitest';

// Runs the timers a screen asked for by hand. Only the clock is faked in the
// tests that poll: the polling of the test library and the mock server need
// real timers, so the interval that refreshes a read is not waited for but
// run on request.
export interface IIntervals {
  // Runs every interval of the given period that is still running, as the
  // timer would after that time. A screen whose read is switched off has none
  // running, and then nothing happens.
  run: (delay: number) => void;
  restore: () => void;
}

export function trackIntervals(): IIntervals {
  const started: MockInstance<typeof setInterval> = vi.spyOn(
    globalThis,
    'setInterval',
  );
  const stopped: MockInstance<typeof clearInterval> = vi.spyOn(
    globalThis,
    'clearInterval',
  );

  return {
    run(delay) {
      const cleared = new Set(stopped.mock.calls.map(([id]) => id));
      const running = started.mock.calls.filter(
        ([, period], index) =>
          period === delay && !cleared.has(started.mock.results[index]?.value),
      );
      act(() => {
        for (const [callback] of running) {
          (callback as () => void)();
        }
      });
    },
    restore() {
      started.mockRestore();
      stopped.mockRestore();
    },
  };
}
