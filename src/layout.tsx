import { t } from '@lingui/core/macro';
import {
  Divider,
  DropdownItem,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MastheadToggle,
  Page,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
} from '@patternfly/react-core';
import QuestionCircleIcon from '@patternfly/react-icons/dist/esm/icons/question-circle-icon';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  AlertList,
  type AlertType,
  DarkmodeSwitcher,
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
        to='https://docs.pulpproject.org/'
        isExternalLink
        rel='nofollow noopener noreferrer'
      >
        {t`Documentation`}
      </DropdownItem>,
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
}) => {
  const navigate = useNavigate();

  return (
    <StatefulDropdown
      ariaLabel={t`User dropdown`}
      data-cy='user-dropdown'
      defaultText={username}
      items={[
        <DropdownItem isDisabled key='username'>
          {t`Username: ${username}`}
        </DropdownItem>,
        <Divider component='li' key='separator' />,
        <DropdownItem
          key='profile'
          onClick={() => navigate(formatPath(Paths.core.user.profile))}
        >
          {t`My profile`}
        </DropdownItem>,
        <DropdownItem
          key='logout'
          aria-label={'logout'}
          onClick={() => logout()}
        >
          {t`Logout`}
        </DropdownItem>,
      ]}
      toggleType='dropdown'
    />
  );
};

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
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton isHamburgerButton></PageToggleButton>
        </MastheadToggle>
        <MastheadBrand>
          <MastheadLogo>
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
          </MastheadLogo>
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
            color:
              'var(--pf-t--temp--dev--tbd)' /* CODEMODS: original v5 color was --pf-v5-global--Color--200 */,
            display: 'block',
            padding: 'var(--pf-t--global--spacer--md)',
          }}
        >
          {`pulp-ui ${UI_BUILD_INFO?.version} (${UI_BUILD_INFO?.hash?.slice(0, 7)})`}
        </small>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page isManagedSidebar masthead={Header} sidebar={Sidebar}>
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
