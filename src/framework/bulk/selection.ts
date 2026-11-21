import { useCallback, useMemo, useState } from 'react';

// The rows of a list the user ticked for a bulk action. The selection belongs
// to one page of one list: it is held under the text of the address that shows
// that page (page, size, order and filters), so any change of the address
// starts from an empty selection, and a row that is no longer on the page is
// never counted. Nothing outside the page can be selected.

interface Held {
  scope: string;
  hrefs: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

export interface PageSelection {
  // The addresses of the selected rows that are on the page.
  selected: ReadonlySet<string>;
  count: number;
  // Every row of the page is selected and there is at least one.
  allSelected: boolean;
  // Ticks or unticks one row. The function keeps its identity while the page
  // does, so rows that receive it are not rebuilt by a selection change.
  toggle: (href: string, checked: boolean) => void;
  // Ticks every row of the page, or none.
  toggleAll: (checked: boolean) => void;
  clear: () => void;
}

// `scope` names the page; `shown` is the addresses of its rows, in order, and
// must keep its identity while the rows do.
export function usePageSelection(
  scope: string,
  shown: readonly string[],
): PageSelection {
  const [held, setHeld] = useState<Held>({ scope, hrefs: NONE });
  // A page the selection was not made on starts empty, and what was held for
  // the page before is forgotten, so coming back to it does not bring it back.
  if (held.scope !== scope) {
    setHeld({ scope, hrefs: NONE });
  }
  const current = held.scope === scope ? held.hrefs : NONE;

  const selected = useMemo(
    () =>
      current.size === 0
        ? NONE
        : new Set(shown.filter((href) => current.has(href))),
    [current, shown],
  );

  const toggle = useCallback(
    (href: string, checked: boolean) =>
      setHeld((previous) => {
        const base = previous.scope === scope ? previous.hrefs : NONE;
        if (base.has(href) === checked) {
          return previous.scope === scope ? previous : { scope, hrefs: base };
        }
        const next = new Set(base);
        if (checked) {
          next.add(href);
        } else {
          next.delete(href);
        }
        return { scope, hrefs: next };
      }),
    [scope],
  );

  const toggleAll = useCallback(
    (checked: boolean) =>
      setHeld({ scope, hrefs: checked ? new Set(shown) : NONE }),
    [scope, shown],
  );

  const clear = useCallback(() => setHeld({ scope, hrefs: NONE }), [scope]);

  return {
    selected,
    count: selected.size,
    allSelected: shown.length > 0 && selected.size === shown.length,
    toggle,
    toggleAll,
    clear,
  };
}
