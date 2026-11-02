import { msg, t } from '@lingui/core/macro';
import {
  Button,
  Checkbox,
  Form,
  FormGroup,
  Modal,
} from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import { PythonDistributionAPI } from '../api/python-distribution';
import { PythonRemoteAPI } from '../api/python-remote';
import { type AlertType } from '../components/alert-list';
import { FormFieldHelper } from '../components/form-field-helper';
import { Spinner } from '../components/patternfly-wrappers/l10n';
import { Typeahead } from '../components/typeahead';
import { changedFields } from '../utilities/changed-fields';
import { saveErrorMessages } from '../utilities/create-repository';
import { type ErrorMessagesType } from '../utilities/map-error-messages';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import { requestErrorText } from '../utilities/request-error';
import { taskAlert } from '../utilities/task-alert';
import { TaskPending, waitForTaskUrl } from '../utilities/wait-for-task';
import { Action } from './action';

interface Target {
  name: string;
  pulp_href: string;
}

interface RemoteChoice {
  name: string;
  id: string;
}

const fieldMessage = (messages: ErrorMessagesType, field: string) => {
  const message: unknown = messages[field];
  return Array.isArray(message) ? message.join(' ') : (message as string);
};

// Changes the pull-through remote and the upload permission of one
// distribution. The name, base path, repository and content guard are not
// offered, so this dialog cannot change them.
const EditModal = ({
  addAlert,
  cancelAction,
  savedAction,
  target,
}: {
  addAlert: (alert: AlertType) => void;
  cancelAction: () => void;
  // closes the dialog and loads the page again
  savedAction: () => void;
  target: Target;
}) => {
  const { name, pulp_href } = target;
  const id = parsePulpIDFromURL(pulp_href);

  // the distribution as the server returned it when the dialog opened
  const [loaded, setLoaded] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteChoice | null>(null);
  const [allowUploads, setAllowUploads] = useState(true);
  const [remotes, setRemotes] = useState<
    (RemoteChoice & { pulp_href: string })[]
  >([]);
  const [remotesError, setRemotesError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ErrorMessagesType>({});
  const [saving, setSaving] = useState(false);

  const loadRemotes = (search?: string) => {
    setRemotesError(null);
    PythonRemoteAPI.list(search ? { name__icontains: search } : {})
      .then(({ data }) =>
        setRemotes(
          data.results.map((r) => ({ ...r, id: r.pulp_href as string })),
        ),
      )
      .catch((e) => {
        setRemotes([]);
        setRemotesError(requestErrorText(e));
      });
  };

  useEffect(() => {
    // a load that is no longer the current one must not change the form
    let current = true;

    loadRemotes();
    PythonDistributionAPI.get(id)
      .then(async ({ data }) => {
        let choice: RemoteChoice | null = null;
        if (data.remote) {
          // the remote is named by its name, which the distribution only
          // carries as a link; without the name the link itself is shown
          choice = await PythonRemoteAPI.get(parsePulpIDFromURL(data.remote))
            .then(({ data: r }) => ({ name: r.name, id: data.remote }))
            .catch(() => ({ name: data.remote, id: data.remote }));
        }
        if (current) {
          setLoaded(data);
          setAllowUploads(data.allow_uploads !== false);
          setRemote(choice);
        }
      })
      .catch((e) => {
        if (current) {
          setLoadError(requestErrorText(e));
        }
      });

    return () => {
      current = false;
    };
  }, [id]);

  const save = async () => {
    const changes = changedFields(loaded, {
      remote: remote?.id ?? null,
      allow_uploads: allowUploads,
    });

    if (!Object.keys(changes).length) {
      addAlert({
        variant: 'info',
        title: t`Nothing changed in distribution ${name}.`,
      });
      cancelAction();
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      const { data } = await PythonDistributionAPI.patch(id, changes);
      // the server answers with a task when something changed, and with the
      // distribution itself when it did not
      if (data?.task) {
        await waitForTaskUrl(data.task);
      }
      addAlert({
        variant: 'success',
        title: t`Updated distribution ${name}`,
      });
      savedAction();
    } catch (e) {
      if (e instanceof TaskPending) {
        addAlert(
          taskAlert(
            e.taskHref,
            t`The update of distribution ${name} is still running.`,
            'warning',
          ),
        );
        savedAction();
      } else {
        setErrors(saveErrorMessages(e));
        setSaving(false);
      }
    }
  };

  return (
    <Modal
      actions={[
        <Button
          key='save'
          variant='primary'
          onClick={save}
          isDisabled={!loaded || saving}
        >
          {t`Save`}
          {saving && <Spinner size='sm' />}
        </Button>,
        <Button key='cancel' variant='link' onClick={cancelAction}>
          {t`Cancel`}
        </Button>,
      ]}
      isOpen
      onClose={cancelAction}
      title={t`Edit distribution`}
      variant='small'
    >
      <p>{name}</p>
      {loadError ? (
        <FormFieldHelper variant='error'>
          {t`Failed to load the distribution: ${loadError}`}
        </FormFieldHelper>
      ) : !loaded ? (
        <Spinner size='md' />
      ) : (
        <Form>
          <FormGroup fieldId='remote' label={t`Pull-through remote`}>
            <Typeahead
              loadResults={loadRemotes}
              onClear={() => setRemote(null)}
              onSelect={(_event, value) => {
                const chosen = remotes.find((r) => r.name === value);
                if (chosen) {
                  setRemote({ name: chosen.name, id: chosen.pulp_href });
                }
              }}
              placeholderText={t`Select a remote`}
              results={remotes}
              selections={remote ? [remote] : []}
            />
            <FormFieldHelper
              variant={errors['remote'] || remotesError ? 'error' : 'default'}
            >
              {fieldMessage(errors, 'remote') ||
                (remotesError
                  ? t`Failed to load remotes: ${remotesError}`
                  : t`Packages missing from this distribution are fetched from the remote. Leave it empty to serve only what was uploaded.`)}
            </FormFieldHelper>
          </FormGroup>
          <FormGroup fieldId='allow_uploads' label={t`Uploads`}>
            <Checkbox
              id='allow_uploads'
              isChecked={allowUploads}
              label={t`Allow uploads to this distribution`}
              onChange={(_event, value) => setAllowUploads(value)}
            />
            <FormFieldHelper
              variant={errors['allow_uploads'] ? 'error' : 'default'}
            >
              {fieldMessage(errors, 'allow_uploads')}
            </FormFieldHelper>
          </FormGroup>
          {errors['__nofield'] ? (
            <FormFieldHelper variant='error'>
              {fieldMessage(errors, '__nofield')}
            </FormFieldHelper>
          ) : null}
        </Form>
      )}
    </Modal>
  );
};

const STATE_KEY = 'pythonDistributionEditModal';

export const pythonDistributionEditAction = Action({
  title: msg`Edit`,
  modal: ({ addAlert, query, setState, state }) =>
    state?.[STATE_KEY] ? (
      <EditModal
        key={state[STATE_KEY].pulp_href}
        addAlert={addAlert}
        cancelAction={() => setState({ [STATE_KEY]: null })}
        savedAction={() => {
          setState({ [STATE_KEY]: null });
          query();
        }}
        target={state[STATE_KEY]}
      />
    ) : null,
  onClick: ({ name, pulp_href }, { setState }) =>
    setState({ [STATE_KEY]: { name, pulp_href } }),
  visible: (_item, { hasPermission }) =>
    hasPermission('python.change_pythondistribution'),
});
