import { useEffect, useRef } from 'react';

// Numbers the reads of one screen so that only the answer to the newest read
// is used. A slower answer to an earlier read (another version, another page,
// a state before signing in again) would otherwise land last and replace what
// the user asked for.
export class LatestRead {
  private latest = 0;

  // Takes the number for a read that is about to start. Every ticket handed
  // out before is stale from now on.
  start(): number {
    this.latest += 1;
    return this.latest;
  }

  isLatest(ticket: number): boolean {
    return ticket === this.latest;
  }

  // Makes every ticket handed out so far stale, for a screen that no longer
  // shows what its pending reads were for.
  invalidate(): void {
    this.latest += 1;
  }
}

// One guard for the lifetime of the component. Its pending reads are stale once
// the component is gone.
export function useLatestRead(): LatestRead {
  const ref = useRef<LatestRead | null>(null);
  if (!ref.current) {
    ref.current = new LatestRead();
  }
  const reads = ref.current;

  useEffect(() => () => reads.invalidate(), [reads]);

  return reads;
}
