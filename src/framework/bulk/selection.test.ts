import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePageSelection } from './selection';

const SHOWN = ['/a/', '/b/', '/c/'];

describe('Unit: page selection', { tags: ['unit'] }, () => {
  it('starts empty and ticks and unticks single rows', () => {
    const { result } = renderHook(() => usePageSelection('?page=1', SHOWN));

    expect(result.current.count).toBe(0);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggle('/b/', true));
    expect(Array.from(result.current.selected)).toEqual(['/b/']);

    act(() => result.current.toggle('/a/', true));
    expect(result.current.count).toBe(2);

    act(() => result.current.toggle('/b/', false));
    expect(Array.from(result.current.selected)).toEqual(['/a/']);
  });

  it('ticks every row of the page at once and clears them again', () => {
    const { result } = renderHook(() => usePageSelection('?page=1', SHOWN));

    act(() => result.current.toggleAll(true));
    expect(result.current.count).toBe(3);
    expect(result.current.allSelected).toBe(true);

    act(() => result.current.toggleAll(false));
    expect(result.current.count).toBe(0);

    act(() => result.current.toggleAll(true));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it('starts again from nothing when the address of the page changes, and never counts a row that is not on the page', () => {
    const { result, rerender } = renderHook(
      ({ scope, shown }) => usePageSelection(scope, shown),
      { initialProps: { scope: '?page=1', shown: SHOWN } },
    );
    act(() => result.current.toggleAll(true));

    rerender({ scope: '?page=2', shown: ['/d/', '/e/'] });
    expect(result.current.count).toBe(0);
    expect(result.current.allSelected).toBe(false);

    // coming back to the first page does not bring the old selection back
    rerender({ scope: '?page=1', shown: SHOWN });
    expect(result.current.count).toBe(0);

    // a row that disappears from the same page leaves the selection
    act(() => result.current.toggleAll(true));
    rerender({ scope: '?page=1', shown: ['/a/', '/c/'] });
    expect(Array.from(result.current.selected)).toEqual(['/a/', '/c/']);
    expect(result.current.allSelected).toBe(true);
  });

  it('keeps the same toggle function while the page does not change, so memoized rows are not rebuilt', () => {
    const { result, rerender } = renderHook(() =>
      usePageSelection('?page=1', SHOWN),
    );
    const first = result.current.toggle;

    act(() => result.current.toggle('/a/', true));
    rerender();

    expect(result.current.toggle).toBe(first);
  });
});
