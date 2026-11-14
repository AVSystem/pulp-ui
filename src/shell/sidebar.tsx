import { t } from '@lingui/core/macro';
import { Button, PageContext, PageSidebarBody } from '@patternfly/react-core';
import AngleLeftIcon from '@patternfly/react-icons/dist/esm/icons/angle-left-icon';
import { useContext } from 'react';
import { PulpMenu } from 'src/menu';
import { usePlugins } from 'src/plugins';
import { CommandPalette } from './command-palette';

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
