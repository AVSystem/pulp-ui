import { t } from '@lingui/core/macro';
import {
  Button,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useUserContext } from 'src/user-context';
import './reauth-dialog.scss';
import { useSessionEnded } from './session-events';

const PASSWORD_ID = 'pulp-reauth-password';

// Shown over the current screen while the session of the signed-in user has
// ended. It cannot be dismissed: the screen behind it looks alive but every
// request would be refused.
export const ReauthDialog = () => {
  const { ended } = useSessionEnded();

  return ended ? <ReauthDialogContent /> : null;
};

const ReauthDialogContent = () => {
  const { user, signInAgain } = useUserContext();
  const titleId = useId();
  const bodyId = useId();

  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // One sign-in request per submit, also before the disabled state renders.
  const inFlight = useRef(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);

    signInAgain(username, password).catch(() => undefined);
  };

  return (
    <Modal
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      elementToFocus={`#${PASSWORD_ID}`}
      isOpen
      variant='small'
    >
      <ModalHeader
        labelId={titleId}
        title={t`Sign in again`}
        titleIconVariant='warning'
      />
      <ModalBody id={bodyId}>
        <p>{t`Your session has ended. Log in to continue.`}</p>
        <Form onSubmit={onSubmit}>
          <FormGroup label={t`Username`} isRequired fieldId='pulp-reauth-user'>
            <TextInput
              id='pulp-reauth-user'
              isDisabled={submitting}
              isRequired
              onChange={(_event, value) => setUsername(value)}
              type='text'
              value={username}
            />
          </FormGroup>
          <FormGroup label={t`Password`} isRequired fieldId={PASSWORD_ID}>
            <TextInput
              id={PASSWORD_ID}
              isDisabled={submitting}
              isRequired
              onChange={(_event, value) => setPassword(value)}
              type='password'
              value={password}
            />
          </FormGroup>
          <Button
            isBlock
            isDisabled={submitting}
            isLoading={submitting}
            type='submit'
            variant='primary'
          >
            {t`Log in`}
          </Button>
        </Form>
      </ModalBody>
    </Modal>
  );
};
