import { t } from '@lingui/core/macro';
import { Button, PageContext, PageSidebarBody } from '@patternfly/react-core';
import AngleLeftIcon from '@patternfly/react-icons/dist/esm/icons/angle-left-icon';
import { useContext, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { PulpMenu } from 'src/menu';
import { usePlugins } from 'src/plugins';
import { CommandPalette } from './command-palette';

// The id of the top bar button that opens and closes the sidebar; focus
// returns to it when the drawer closes.
export const SIDEBAR_TOGGLE_ID = 'pulp-sidebar-toggle';

// Where the browser remembers whether the sidebar was left open or collapsed.
export const SIDEBAR_STORAGE_KEY = 'pulp-sidebar';

// The width from which the sidebar stays on screen next to the content. Below
// it the sidebar is a drawer, which is always closed when a page loads.
const PERSISTENT_SIDEBAR_WIDTH = 1200;

type SidebarPreference = 'open' | 'collapsed';

// Only the two known values mean anything; every other value, and a browser
// that refuses access to its storage, count as open.
function readPreference(): SidebarPreference {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'
      ? 'collapsed'
      : 'open';
  } catch {
    return 'open';
  }
}

function writePreference(value: SidebarPreference) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
  } catch {
    // The choice then lasts for this page only.
  }
}

// Whether the sidebar starts open: the remembered choice counts on a wide
// screen only.
export function initialSidebarOpen(): boolean {
  return (
    window.innerWidth < PERSISTENT_SIDEBAR_WIDTH || readPreference() === 'open'
  );
}

// The state of the page's sidebar and the one way to change it, shared by the
// button in the sidebar footer and the toggle in the top bar. On a wide screen
// the new state is remembered; the drawer of a narrow screen is not.
export function useSidebar() {
  const { isSidebarOpen, isMobile, onSidebarToggle } = useContext(PageContext);

  const toggle = () => {
    onSidebarToggle();
    if (!isMobile) {
      writePreference(isSidebarOpen ? 'collapsed' : 'open');
    }
  };

  return { isOpen: isSidebarOpen, isNarrow: isMobile, toggle };
}

// Open parts of the page that answer Escape themselves: a dialog, an open menu
// or the notification panel. Escape then belongs to them, not to the drawer.
const OWN_ESCAPE =
  '.pf-v6-c-modal-box, .pf-v6-c-menu, .pf-v6-c-notification-drawer__header:focus-within, .pulp-notifications:focus-within';

// What the sidebar does as a drawer, below the width of the persistent
// sidebar: it closes on a route change and on Escape, and focus goes back to
// the button that opened it however it closed. Renders a dim layer behind the
// drawer; the page's own handler closes the drawer on a press on it, since the
// layer sits in the main container.
export const SidebarDrawer = () => {
  const { isSidebarOpen, isMobile, onSidebarToggle } = useContext(PageContext);
  const { pathname } = useLocation();
  const shown = isMobile && isSidebarOpen;

  // Always the latest, so the listeners below need not be set up again.
  const closeRef = useRef(onSidebarToggle);
  closeRef.current = onSidebarToggle;

  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) {
      return;
    }
    lastPath.current = pathname;
    if (shown) {
      closeRef.current();
    }
  }, [pathname, shown]);

  useEffect(() => {
    if (!shown) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector(OWN_ESCAPE)
      ) {
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shown]);

  // A press on the layer closes the drawer through the page's own handler,
  // which unmounts the layer before the browser's default action would move
  // focus to the page; handling the press first keeps focus on the toggle. A
  // tap also must not turn into a click on whatever lies under the layer.
  useEffect(() => {
    if (!shown) {
      return;
    }
    const onPress = (event: MouseEvent | TouchEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.pulp-drawer-backdrop')
      ) {
        event.preventDefault();
        document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
      }
    };
    document.addEventListener('mousedown', onPress, true);
    document.addEventListener('touchstart', onPress, {
      capture: true,
      passive: false,
    });
    return () => {
      document.removeEventListener('mousedown', onPress, true);
      document.removeEventListener('touchstart', onPress, true);
    };
  }, [shown]);

  // A drawer that was open and is closed on a narrow screen gives focus back
  // to its toggle; a window widened past the breakpoint is not a close.
  const wasShown = useRef(false);
  useEffect(() => {
    if (wasShown.current && isMobile && !isSidebarOpen) {
      document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
    }
    wasShown.current = shown;
  }, [shown, isMobile, isSidebarOpen]);

  return shown ? (
    <div className='pulp-drawer-backdrop' data-cy='sidebar-backdrop' />
  ) : null;
};

function SidebarFooter() {
  const plugins = usePlugins();
  const { isNarrow, toggle } = useSidebar();

  // The server's core version, once the server has answered with it.
  const version =
    plugins.state === 'ready' ? plugins.versions.get('core') : undefined;

  return (
    <div className='pulp-sidebar__footer'>
      <div className='pulp-sidebar__meta'>
        {version ? <span>{t`Pulp ${version}`}</span> : null}
        {isNarrow ? (
          <span className='pulp-sidebar__host'>{window.location.host}</span>
        ) : null}
      </div>
      {isNarrow ? null : (
        <Button
          variant='plain'
          className='pulp-sidebar__collapse'
          aria-label={t`Collapse sidebar`}
          icon={<AngleLeftIcon />}
          onClick={toggle}
        />
      )}
    </div>
  );
}

// The contents of the sidebar: the menu, which scrolls, and a footer that
// stays in view below it.
export const SidebarContent = () => (
  <>
    <PageSidebarBody className='pulp-sidebar__menu'>
      <CommandPalette />
      <PulpMenu />
    </PageSidebarBody>
    <SidebarFooter />
  </>
);
