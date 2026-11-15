import { act } from '@testing-library/react';
import { vi } from 'vitest';

// waitFor cannot run while timers are faked. This lets the pending requests
// and renders settle, then moves the fake clock by the given time and lets
// what that triggers settle as well.
export async function settle(ms = 0) {
  const rounds = async () => {
    for (let round = 0; round < 3; round++) {
      await act(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(0);
      });
    }
  };
  await rounds();
  if (ms > 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await rounds();
  }
}
