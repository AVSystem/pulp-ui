import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LatestRead, useLatestRead } from './latest-read';

describe('the latest read guard', () => {
  it('hands out a different ticket for every read', () => {
    const reads = new LatestRead();

    expect(new Set([reads.start(), reads.start(), reads.start()]).size).toBe(3);
  });

  it('counts the ticket of the newest read as the latest', () => {
    const reads = new LatestRead();
    const ticket = reads.start();

    expect(reads.isLatest(ticket)).toBe(true);
  });

  it('makes the ticket of an earlier read stale as soon as a new read starts', () => {
    const reads = new LatestRead();
    const earlier = reads.start();
    const newer = reads.start();

    expect(reads.isLatest(earlier)).toBe(false);
    expect(reads.isLatest(newer)).toBe(true);
  });

  it('keeps the newest ticket latest when a stale one is asked about', () => {
    const reads = new LatestRead();
    const earlier = reads.start();
    const newer = reads.start();

    reads.isLatest(earlier);

    expect(reads.isLatest(newer)).toBe(true);
  });

  it('makes every ticket stale when it is invalidated', () => {
    const reads = new LatestRead();
    const ticket = reads.start();

    reads.invalidate();

    expect(reads.isLatest(ticket)).toBe(false);
  });

  it('does not treat a ticket that was never handed out as the latest', () => {
    const reads = new LatestRead();
    reads.start();

    expect(reads.isLatest(0)).toBe(false);
    expect(reads.isLatest(99)).toBe(false);
  });
});

describe('the latest read guard of a component', () => {
  it('is the same guard on every render', () => {
    const { result, rerender } = renderHook(() => useLatestRead());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('keeps a ticket latest while the component is shown', () => {
    const { result, rerender } = renderHook(() => useLatestRead());
    const ticket = result.current.start();

    rerender();

    expect(result.current.isLatest(ticket)).toBe(true);
  });

  it('makes a pending ticket stale once the component is gone', () => {
    const { result, unmount } = renderHook(() => useLatestRead());
    const reads = result.current;
    const ticket = reads.start();

    unmount();

    expect(reads.isLatest(ticket)).toBe(false);
  });
});
