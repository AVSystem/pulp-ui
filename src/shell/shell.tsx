import { t } from '@lingui/core/macro';
import {
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MastheadToggle,
  Page,
  PageSidebar,
  PageToggleButton,
  SkipToContent,
} from '@patternfly/react-core';
import { type ComponentPropsWithoutRef, type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertList,
  type AlertType,
  LanguageSwitcher,
  LoginLink,
  PulpAboutModal,
  closeAlert,
} from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { useUserContext } from 'src/user-context';
import PulpLogoIcon from 'static/images/pulp_logo_icon.svg';
import { AccountMenu } from './account-menu';
import { BreadcrumbBar, BreadcrumbSlotProvider } from './breadcrumb-slot';
import { HelpMenu } from './help-menu';
import { SidebarContent, initialSidebarOpen, useSidebar } from './sidebar';
import { ThemeMenu } from './theme-menu';

export const MAIN_CONTENT_ID = 'main-content';

// A router link that carries the class and attributes PatternFly puts on its
// logo, so the whole brand cell is one link to the Status screen.
const StatusLink = (props: ComponentPropsWithoutRef<'a'>) => (
  <Link {...props} to={formatPath(Paths.core.status)} />
);

// The logo, the product name and the server the page is served from, as one
// link. The host is read from the address of the running page.
const BrandCell = () => {
  const host = window.location.host;

  return (
    <MastheadLogo
      className='pulp-brand'
      component={StatusLink}
      aria-label={t`Pulp, ${host}`}
    >
      <img className='pulp-brand__logo' src={PulpLogoIcon} alt='' />
      <span className='pulp-brand__text'>
        <span className='pulp-brand__name'>Pulp</span>
        <span className='pulp-brand__host'>{host}</span>
      </span>
    </MastheadLogo>
  );
};

const ShellMasthead = ({
  username,
  signOut,
  showAbout,
}: {
  username?: string;
  signOut: () => void;
  showAbout: () => void;
}) => {
  const { isOpen, isNarrow, toggle } = useSidebar();
  // On a wide screen with the sidebar open, the brand cell continues the
  // sidebar column and the sidebar footer holds the button that collapses it.
  const framed = !isNarrow && isOpen;

  const toggleLabel = isNarrow
    ? isOpen
      ? t`Close navigation`
      : t`Open navigation`
    : t`Expand sidebar`;

  return (
    <Masthead
      className={framed ? 'pulp-masthead pulp-framed' : 'pulp-masthead'}
    >
      <MastheadMain>
        {framed ? null : (
          <MastheadToggle>
            <PageToggleButton
              isHamburgerButton
              aria-label={toggleLabel}
              onClick={toggle}
            />
          </MastheadToggle>
        )}
        <MastheadBrand>
          <BrandCell />
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <BreadcrumbBar />
        <div className='pulp-topbar__actions'>
          <HelpMenu showAbout={showAbout} />
          <ThemeMenu />
          <LanguageSwitcher />
          {username ? (
            <AccountMenu username={username} logout={signOut} />
          ) : (
            <LoginLink button />
          )}
        </div>
      </MastheadContent>
    </Masthead>
  );
};

// The frame of every screen: top bar with the brand cell, sidebar with the
// navigation, and the main container the routed screen renders into.
export const Shell = ({ children }: { children: ReactNode }) => {
  const [aboutModalVisible, setAboutModalVisible] = useState<boolean>(false);
  // Read once: the page only uses it when it starts.
  const [startsOpen] = useState(initialSidebarOpen);
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

  return (
    <BreadcrumbSlotProvider>
      <Page
        isManagedSidebar
        defaultManagedSidebarIsOpen={startsOpen}
        masthead={
          <ShellMasthead
            username={username}
            signOut={signOut}
            showAbout={() => setAboutModalVisible(true)}
          />
        }
        sidebar={
          <PageSidebar>
            <SidebarContent />
          </PageSidebar>
        }
        skipToContent={
          <SkipToContent href={`#${MAIN_CONTENT_ID}`}>
            {t`Skip to content`}
          </SkipToContent>
        }
        mainContainerId={MAIN_CONTENT_ID}
      >
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
    </BreadcrumbSlotProvider>
  );
};
