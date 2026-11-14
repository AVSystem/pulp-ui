import { t } from '@lingui/core/macro';
import {
  Divider,
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownList,
  MenuToggle,
  type MenuToggleElement,
} from '@patternfly/react-core';
import { type Ref, useState } from 'react';
import { useNavigate } from 'react-router';
import { Paths, formatPath } from 'src/paths';

// Up to two characters that stand for the user: the first letters of the
// first two parts of a name written with dots, dashes or underscores, or the
// first two characters of a name in one piece.
export function initialsOf(username: string): string {
  const parts = username.split(/[._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2
      ? [parts[0], parts[1]].map((part) => Array.from(part)[0])
      : Array.from(parts[0] ?? '').slice(0, 2);
  return letters.join('').toUpperCase();
}

interface IProps {
  // Not known yet: the toggle then has no initials and no name.
  username?: string;
  logout: () => void;
}

// The signed-in user: an avatar with initials and the name, opening the
// account menu. The name is only ever rendered as text.
export const AccountMenu = ({ username, logout }: IProps) => {
  const [isOpen, setOpen] = useState(false);
  const navigate = useNavigate();

  const toggle = (toggleRef: Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      className='pulp-account'
      data-cy='user-dropdown'
      aria-label={username ? t`Account menu for ${username}` : t`Account`}
      isExpanded={isOpen}
      onClick={() => setOpen(!isOpen)}
    >
      {username ? (
        <>
          <span className='pulp-account__avatar' aria-hidden='true'>
            {initialsOf(username)}
          </span>
          <span className='pulp-account__name' title={username}>
            {username}
          </span>
        </>
      ) : null}
    </MenuToggle>
  );

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setOpen}
      onSelect={() => setOpen(false)}
      shouldFocusToggleOnSelect
      popperProps={{ position: 'end' }}
      toggle={toggle}
    >
      <DropdownGroup
        label={username ? t`Signed in as ${username}` : undefined}
        labelHeadingLevel='h2'
      >
        <DropdownList>
          <DropdownItem
            key='profile'
            onClick={() => navigate(formatPath(Paths.core.user.profile))}
          >
            {t`My profile`}
          </DropdownItem>
        </DropdownList>
      </DropdownGroup>
      <Divider />
      <DropdownList>
        <DropdownItem key='logout' aria-label='logout' onClick={() => logout()}>
          {t`Logout`}
        </DropdownItem>
      </DropdownList>
    </Dropdown>
  );
};
