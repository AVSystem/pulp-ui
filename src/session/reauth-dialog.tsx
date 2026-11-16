import { t } from '@lingui/core/macro';
import {
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { PulpLoginAPI } from 'src/api/pulp-login';
import { LoginLink } from 'src/components/login-link';
import { Paths, formatPath } from 'src/paths';
import { MAIN_CONTENT_ID } from 'src/shell/shell';
import { config } from 'src/ui-config';
import {
  type ISessionUser,
  sessionKey,
  useUserContext,
} from 'src/user-context';
import { loginErrorMessage } from 'src/utilities/login-error';
import { uiPath } from 'src/utilities/ui-path';
import './reauth-dialog.scss';
import {
  isSignedOutPath,
  reportUnauthorized,
  resume,
  useSessionEnded,
} from './session-events';

const PASSWORD_ID = 'pulp-reauth-password';
const USERNAME_ID = 'pulp-reauth-username';
const EXTERNAL_LOGIN_CLASS = 'pulp-reauth__login';
// Each sentence above the form is a paragraph of its own with the same gap
// below it; a sentence that does not apply is not rendered and leaves no gap.
const TEXT_CLASS = 'pulp-reauth__text';
const NOTE_CLASS = `${TEXT_CLASS} pulp-reauth__note`;

// Pages that deal with signing in themselves: a dialog over them would ask
// twice.
const isSignInPage = (pathname: string) => {
  const path = pathname.replace(/\/+$/, '') || '/';
  return (
    path === formatPath(Paths.meta.login).replace(/\/+$/, '') ||
    isSignedOutPath(pathname)
  );
};

// Asks the server once, when the user comes back to the tab, whether the
// session is still alive and still belongs to the account in memory. A 401 or
// a 403 means the session has ended and opens the dialog. An answer naming
// another account (another tab signed in as someone else) loads the start page
// afresh, because everything in memory belongs to the previous account. A
// server error or a lost connection says nothing about the session and is
// ignored without a word. No timer runs, so a tab that stays in view is never
// polled; and nothing is asked while nobody is signed in, while the dialog is
// already open or on a page that deals with signing in itself.
function useTabReturnCheck(user: ISessionUser | null, onSignInPage: boolean) {
  const { restoreSession } = useUserContext();
  const inFlight = useRef(false);
  // The account in memory when the tab is returned to, without rebinding the
  // listener each time the user object is replaced.
  const key = useRef(sessionKey(user));
  key.current = sessionKey(user);
  // The latest restore, for the same reason: the listener is bound once per
  // sign-in, and a function captured then would be stale.
  const restore = useRef(restoreSession);
  restore.current = restoreSession;
  const signedIn = Boolean(user);

  useEffect(() => {
    if (!signedIn || onSignInPage) {
      return undefined;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || inFlight.current) {
        return;
      }
      inFlight.current = true;
      PulpLoginAPI.whoami()
        .then(({ data }) => {
          const next = { username: data.username, pulp_href: data.pulp_href };
          if (sessionKey(next) === key.current) {
            restore.current(next);
          } else {
            window.location.assign(uiPath(formatPath(Paths.core.status)));
          }
        })
        .catch((error) => {
          const status = error?.response?.status;
          if (status === 401 || status === 403) {
            reportUnauthorized('tab-return');
          }
        })
        .finally(() => {
          inFlight.current = false;
        });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [signedIn, onSignInPage]);
}

// Shown over the current screen while the session of the signed-in user has
// ended. The screen is covered by an opaque layer, so nothing it read with the
// session can be read through the dialog, and stays mounted below it, so what
// was typed or opened in it is still there once the same account signs in
// again. The dialog cannot be dismissed: the screen behind it would look alive
// while every request is refused.
export const ReauthDialog = () => {
  const { ended } = useSessionEnded();
  const { pathname } = useLocation();
  const { user } = useUserContext();
  const hidden = isSignInPage(pathname);
  useTabReturnCheck(user, hidden);
  // Where the focus goes once the dialog has closed after signing in again.
  const returnTo = useRef<Element | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (ended && hidden) {
      resume();
    }
  }, [ended, hidden]);

  const open = ended && !hidden;
  useEffect(() => {
    if (wasOpen.current && !open && !hidden && returnTo.current) {
      const target = returnTo.current;
      returnTo.current = null;
      const element =
        target instanceof HTMLElement && target.isConnected
          ? target
          : document.getElementById(MAIN_CONTENT_ID);
      element?.focus();
    }
    wasOpen.current = open;
  }, [open, hidden]);

  return open ? (
    <ReauthDialogContent
      onOpened={(opener) => {
        returnTo.current = opener;
      }}
    />
  ) : null;
};

const ReauthDialogContent = ({
  onOpened,
}: {
  onOpened: (opener: Element | null) => void;
}) => {
  const { user, signInAgain } = useUserContext();
  const { fromRequest } = useSessionEnded();
  const { pathname, search } = useLocation();
  const titleId = useId();
  const bodyId = useId();
  const external = Boolean(config.UI_EXTERNAL_LOGIN_URI);

  // What had the focus before the dialog took it.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    onOpened(opener);
  }, [onOpened, opener]);
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // One sign-in request per submit, also before the disabled state renders.
  const inFlight = useRef(false);

  // Fields that were disabled lose the focus; give it back after a failure.
  useEffect(() => {
    if (!submitting && error) {
      document.getElementById(PASSWORD_ID)?.focus();
    }
  }, [submitting, error]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError('');

    // Another user's sign-in leaves the page, so the dialog then stays as it
    // is until the page is gone.
    signInAgain(username, password).catch((failure) => {
      setError(loginErrorMessage(failure));
      inFlight.current = false;
      setSubmitting(false);
    });
  };

  const goToLoginPage = () =>
    window.location.assign(
      uiPath(
        formatPath(Paths.meta.login, {}, { next: `${pathname}${search}` }),
      ),
    );

  return (
    <Modal
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      // A translucent backdrop would leave the screen readable through it.
      backdropClassName='pulp-reauth__backdrop'
      elementToFocus={
        external ? `.${EXTERNAL_LOGIN_CLASS} a` : `#${PASSWORD_ID}`
      }
      isOpen
      variant='small'
    >
      <ModalHeader
        labelId={titleId}
        title={t`Sign in again`}
        titleIconVariant='warning'
      />
      <ModalBody id={bodyId}>
        {external ? (
          <>
            <p className={TEXT_CLASS}>
              {t`Your session has ended. You are taken to the login page and back to this page afterwards. Anything you entered on this page is lost.`}
            </p>
            <div className={EXTERNAL_LOGIN_CLASS}>
              <LoginLink button />
            </div>
          </>
        ) : (
          <>
            <p className={TEXT_CLASS}>
              {t`Your session has ended. Log in to continue.`}
            </p>
            {fromRequest ? (
              <p className={NOTE_CLASS}>
                {t`The last action was not completed. Repeat it after you log in.`}
              </p>
            ) : null}
            <p className={NOTE_CLASS}>
              {t`What you have entered on this page is kept.`}
            </p>
            <Form onSubmit={onSubmit}>
              <FormGroup fieldId={USERNAME_ID} isRequired label={t`Username`}>
                <TextInput
                  id={USERNAME_ID}
                  isDisabled={submitting}
                  isRequired
                  onChange={(_event, value) => setUsername(value)}
                  type='text'
                  value={username}
                />
              </FormGroup>
              <FormGroup fieldId={PASSWORD_ID} isRequired label={t`Password`}>
                <TextInput
                  id={PASSWORD_ID}
                  isDisabled={submitting}
                  isRequired
                  onChange={(_event, value) => setPassword(value)}
                  type='password'
                  value={password}
                />
              </FormGroup>
              {error ? (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      <span className='pulp-reauth__error' role='alert'>
                        <ExclamationCircleIcon /> {error}
                      </span>
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              ) : null}
              <Button
                className='pulp-reauth__submit'
                isBlock
                isDisabled={submitting}
                isLoading={submitting}
                type='submit'
                variant='primary'
              >
                {t`Log in`}
              </Button>
            </Form>
          </>
        )}
      </ModalBody>
      {external ? null : (
        <ModalFooter>
          <Button
            className='pulp-reauth__exit'
            onClick={goToLoginPage}
            variant='link'
          >
            {t`Go to the login page`}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
};
