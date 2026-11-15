import { t } from '@lingui/core/macro';
import { DropdownItem } from '@patternfly/react-core';
import OutlinedMoonIcon from '@patternfly/react-icons/dist/esm/icons/outlined-moon-icon';
import OutlinedSunIcon from '@patternfly/react-icons/dist/esm/icons/outlined-sun-icon';
import { useEffect, useState } from 'react';
import { StatefulDropdown } from 'src/components';
import {
  followSystemTheme,
  getBrowserDefault,
  getUserChoice,
  setUserChoice,
} from 'src/darkmode';

const DARK_QUERY = '(prefers-color-scheme: dark)';

// One button for the theme: light, dark, or whatever the system uses. The
// button shows the theme that is in effect.
export const ThemeMenu = () => {
  const [choice, setChoice] = useState(getUserChoice);
  const [system, setSystem] = useState(getBrowserDefault);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = ({ matches }: { matches: boolean }) =>
      setSystem(matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // shows the system theme while no explicit choice is stored
  useEffect(() => followSystemTheme(), []);

  const isDark = (choice ?? system) === 'dark';

  const choose = (value: 'dark' | 'light' | null) => {
    setUserChoice(value);
    setChoice(value);
  };

  return (
    <StatefulDropdown
      ariaLabel={t`Theme`}
      data-cy='darkmode-dropdown'
      toggleClassName='pulp-topbar__button'
      defaultText={
        isDark ? (
          <OutlinedMoonIcon data-icon='moon' />
        ) : (
          <OutlinedSunIcon data-icon='sun' />
        )
      }
      toggleType='icon'
      items={[
        <DropdownItem
          key='light'
          isSelected={choice === 'light'}
          onClick={() => choose('light')}
        >
          {t`Light`}
        </DropdownItem>,
        <DropdownItem
          key='dark'
          isSelected={choice === 'dark'}
          onClick={() => choose('dark')}
        >
          {t`Dark`}
        </DropdownItem>,
        <DropdownItem
          key='system'
          isSelected={choice === null}
          onClick={() => choose(null)}
        >
          {t`Match system`}
        </DropdownItem>,
      ]}
    />
  );
};
