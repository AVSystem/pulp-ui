import { t } from '@lingui/core/macro';
import {
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadMain,
  MastheadToggle,
  Page,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
} from '@patternfly/react-core';
import {
  DropdownItem,
  DropdownSeparator,
} from '@patternfly/react-core/deprecated';
import BarsIcon from '@patternfly/react-icons/dist/esm/icons/bars-icon';
import QuestionCircleIcon from '@patternfly/react-icons/dist/esm/icons/question-circle-icon';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertList,
  type AlertType,
  DarkmodeSwitcher,
  ExternalLink,
  LanguageSwitcher,
  LoginLink,
  PulpAboutModal,
  SmallLogo,
  StatefulDropdown,
  closeAlert,
} from 'src/components';
import { PulpMenu } from './menu';
import { Paths, formatPath } from './paths';
import { useUserContext } from './user-context';

const DocsDropdown = ({ showAbout }: { showAbout: () => void }) => (
  <StatefulDropdown
    ariaLabel={t`Docs dropdown`}
    data-cy='docs-dropdown'
    defaultText={<QuestionCircleIcon />}
    items={[
      <DropdownItem
        key='documentation'
        component={
          <ExternalLink
            href='https://docs.pulpproject.org/'
            variant='menu'
          >{t`Documentation`}</ExternalLink>
        }
      />,
      <DropdownItem key='about' onClick={() => showAbout()}>
        {t`About`}
      </DropdownItem>,
    ]}
    toggleType='icon'
  />
);

const UserDropdown = ({
  username,
  logout,
}: {
  username: string;
  logout: () => void;
}) => (
  <StatefulDropdown
    ariaLabel={t`User dropdown`}
    data-cy='user-dropdown'
    defaultText={username}
    items={[
      <DropdownItem isDisabled key='username'>
        {t`Username: ${username}`}
      </DropdownItem>,
      <DropdownSeparator key='separator' />,
      <DropdownItem
        key='profile'
        component={
          <Link to={formatPath(Paths.core.user.profile)}>{t`My profile`}</Link>
        }
      />,
      <DropdownItem key='logout' aria-label={'logout'} onClick={() => logout()}>
        {t`Logout`}
      </DropdownItem>,
    ]}
    toggleType='dropdown'
  />
);

export const Layout = ({ children }: { children: ReactNode }) => {
  const [aboutModalVisible, setAboutModalVisible] = useState<boolean>(false);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const { user, logout } = useUserContext();

  const username = user?.username;

  // A refused or failed logout leaves the server session alive, so the user is
  // told instead of being shown as signed out.
  const signOut = () =>
    logout().catch((error) =>
      setAlerts((current) => [
        ...current,
        {
          variant: 'danger',
          title: t`Sign-out did not complete`,
          description: (
            <>
              {error.message} {t`You are still signed in.`}
            </>
          ),
        },
      ]),
    );

  const Header = (
    <Masthead>
      <MastheadToggle>
        <PageToggleButton>
          <BarsIcon />
        </PageToggleButton>
      </MastheadToggle>
      <MastheadMain>
        <MastheadBrand>
          <Link to={formatPath(Paths.core.status)}>
            <SmallLogo alt='Pulp UI' />
          </Link>
          <span
            style={{
              padding: '9px 0 0 4px',
            }}
          >
            Pulp UI
          </span>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <span style={{ flexGrow: 1 }} />
        <DarkmodeSwitcher />
        <LanguageSwitcher />
        <DocsDropdown showAbout={() => setAboutModalVisible(true)} />
        {user ? <UserDropdown username={username} logout={signOut} /> : null}
        {!user ? <LoginLink /> : null}
      </MastheadContent>
    </Masthead>
  );

  const Sidebar = (
    <PageSidebar>
      <PageSidebarBody>
        <PulpMenu />
      </PageSidebarBody>
      <PageSidebarBody isFilled={false}>
        <small
          style={{
            color: 'var(--pf-v5-global--Color--200)',
            display: 'block',
            padding: '0 var(--pf-v5-global--spacer--md)',
          }}
        >
          {`pulp-ui ${UI_BUILD_INFO?.version} (${UI_BUILD_INFO?.hash?.slice(0, 7)})`}
        </small>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page isManagedSidebar header={Header} sidebar={Sidebar}>
      <AlertList
        alerts={alerts}
        closeAlert={(index) => closeAlert(index, { alerts, setAlerts })}
      />
      {children}
      {aboutModalVisible ? (
        <PulpAboutModal
          isOpen
          onClose={() => setAboutModalVisible(false)}
          username={username}
        />
      ) : null}
    </Page>
  );
};
