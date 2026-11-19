import { type Locator, type Page, expect } from '@playwright/test';

// Helpers for the tests that watch what a page does while its session has
// ended behind it, in a real browser: returning to a tab, counting the checks
// the page sends, proving that nothing readable shows through the sign-in
// dialog, and proving that the page was not reloaded.

export type Return = 'visibility' | 'focus';

// Tells the page that the user came back to it, from inside the page. A
// headless browser keeps reporting every page of a context as visible and never
// emits a visibility change or a focus when another page of the context comes
// to the front, so the event is dispatched on the document or on the window,
// which is exactly what the handlers listen to. The test fails, with a message
// that says so, when the browser reports the page as hidden: a handler that
// ignores hidden pages would otherwise pass without having been exercised.
export async function returnToTab(page: Page, how: Return): Promise<void> {
  const state = await page.evaluate(() => document.visibilityState);
  expect(
    state,
    'the browser hid the page, so a dispatched return would not reach the handler as a real one does',
  ).toBe('visible');

  await page.evaluate((kind) => {
    if (kind === 'visibility') {
      document.dispatchEvent(new Event('visibilitychange'));
    } else {
      window.dispatchEvent(new Event('focus'));
    }
  }, how);
}

// Records the status of every GET of the login endpoint that the page gets
// answered from now on. Register it after the page has loaded, so the check the
// application makes while starting up is not counted.
export function loginChecks(page: Page): { statuses: number[] } {
  const statuses: number[] = [];
  page.on('response', (response) => {
    if (
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/pulp/api/v3/login/'
    ) {
      statuses.push(response.status());
    }
  });
  return { statuses };
}

// Ends the server session behind the page's back, the way another tab or an
// expiry would: the page still looks signed in until its next request. Returns
// the status of the DELETE.
export async function endSessionBehindThePage(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const token = /(?:^|; )csrftoken=([^;]*)/.exec(document.cookie)?.[1];
    const response = await fetch('/pulp/api/v3/login/', {
      method: 'DELETE',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': token ?? '',
      },
    });
    return response.status;
  });
}

// Waits until every finite animation and transition of the page has ended, so
// a layer that is still fading in is not mistaken for one that is partly
// transparent.
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return timing !== undefined && Number.isFinite(timing.endTime);
        })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

// True when the topmost element at the centre of the locator's box lies inside
// the backdrop of the sign-in dialog and that backdrop is fully opaque. The
// component library draws an animated backdrop on a pseudo-element (the
// element's own background stays transparent), so the colour and opacity of the
// pseudo-element count when it paints; otherwise the element's own colour does.
// Neither the painted layer nor an ancestor may be faded. The element is
// scrolled to the middle of the view first, so its centre is inside the window.
// An element that is not covered is the topmost element itself, which lies
// outside the backdrop. By default the measurement waits for finite animations
// to end; with `settleAnimations` false it is taken at once, which proves the
// layer is opaque from its first frame.
export async function coveredAt(
  page: Page,
  locator: Locator,
  settleAnimations = true,
): Promise<boolean> {
  if (settleAnimations) {
    await settle(page);
  }
  return locator.evaluate((element) => {
    // Alpha of a computed colour: rgb(r, g, b) is opaque, rgba(r, g, b, a) and
    // the slash form of the newer colour syntaxes carry it.
    const alphaOf = (colour: string): number => {
      const slash = /\/\s*([\d.]+)(%?)\s*\)\s*$/.exec(colour);
      if (slash) {
        return Number(slash[1]) / (slash[2] ? 100 : 1);
      }
      const comma = /^rgba\(\s*[^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(
        colour,
      );
      return comma ? Number(comma[1]) : 1;
    };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    const backdrop = top?.closest('.pf-v6-c-backdrop.pulp-reauth__backdrop');
    if (!backdrop) {
      return false;
    }

    const own = getComputedStyle(backdrop);
    const pseudo = getComputedStyle(backdrop, '::before');
    const pseudoPaints =
      pseudo.content !== 'none' && alphaOf(pseudo.backgroundColor) > 0;
    const alpha = pseudoPaints
      ? alphaOf(pseudo.backgroundColor) * Number(pseudo.opacity)
      : alphaOf(own.backgroundColor);

    let faded = false;
    for (let node: Element | null = backdrop; node; node = node.parentElement) {
      if (Number(getComputedStyle(node).opacity) < 1) {
        faded = true;
      }
    }
    return alpha === 1 && !faded;
  });
}

// True when the sign-in dialog's backdrop exists, does not carry the library's
// animation class and has no animation or transition running on it (or on its
// pseudo-elements, which report the backdrop as their target). Unlike a
// measurement taken in the first frame, this holds the same way however fast or
// slow the browser is and with a reduced-motion setting, so a fade-in that came
// back is always found.
export async function backdropIsStill(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const backdrop = document.querySelector(
      '.pf-v6-c-backdrop.pulp-reauth__backdrop',
    );
    if (!backdrop || backdrop.classList.contains('pf-m-animate')) {
      return false;
    }
    return !document
      .getAnimations()
      .some(
        (animation) =>
          animation.playState === 'running' &&
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target === backdrop,
      );
  });
}

// Puts a marker on the window of the page. A page that is loaded afresh loses
// it, so a marker that is still there proves no reload happened.
export async function markWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { returnMarker?: boolean }).returnMarker = true;
  });
}

export async function windowMarked(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as unknown as { returnMarker?: boolean }).returnMarker === true,
  );
}
