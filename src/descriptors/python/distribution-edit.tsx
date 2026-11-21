import { msg, t } from '@lingui/core/macro';
import {
  AlertActionLink,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useId, useMemo, useRef, useState } from 'react';
import { Alert, type AlertType, Spinner } from 'src/components';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import { useEntity, useUpdateEntity } from 'src/entities/plugin/queries';
import { pythonDistribution } from 'src/entities/python/distribution';
import type {
  PythonDistribution,
  PythonDistributionChanges,
} from 'src/entities/python/model';
import { pythonRemote } from 'src/entities/python/remote';
import type { FieldDef } from 'src/framework/descriptor';
import { DescriptorForm } from 'src/framework/form/descriptor-form';
import {
  type FormValues,
  changedNames,
  toForm,
  toRequest,
} from 'src/framework/form/form-values';
import { type SaveFailure, saveFailure } from 'src/framework/form/save-errors';
import { useWatchTask } from 'src/framework/watched-tasks';
import { isSessionEnd, requestErrorText } from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';

// The two fields the dialog offers, which are the only two it ever sends: the
// name, the base path, the repository and the content guard of a distribution
// are not offered, so this dialog cannot change them.
const FIELDS: FieldDef[] = [
  {
    name: 'remote',
    label: msg`Pull-through remote`,
    kind: 'remote',
    hint: msg`Packages missing from this distribution are fetched from the remote. Leave it empty to serve only what was uploaded.`,
  },
  {
    name: 'allow_uploads',
    label: msg`Uploads`,
    kind: 'boolean',
    boxLabel: msg`Allow uploads to this distribution`,
  },
];

const SHOWN = FIELDS.map(({ name }) => name);

interface Props {
  distribution: DistributionBase;
  onClose: () => void;
  addAlert: (alert: AlertType) => void;
}

// What the user has changed in the form, with the distribution it was changed
// from. Until then the form shows what the last read holds, so a read that
// arrives after a sign-in refreshes an untouched form and never replaces one the
// user has changed.
interface Edit {
  values: FormValues;
  shown: PythonDistribution;
}

// Changes the pull-through remote and the upload permission of one python
// distribution. The distribution is read by its address, so the form opens on
// what the server holds now; only the fields that were changed are sent. The
// server answers with a task when something changed, which the application
// follows to its end wherever the user is by then, and with the distribution
// itself when it did not; a refusal or a rejected value stays in the dialog.
export const PythonDistributionEdit = ({
  distribution,
  onClose,
  addAlert,
}: Props) => {
  const { name, pulp_href } = distribution;
  const labelId = useId();
  const query = useEntity(pythonDistribution, pulp_href);
  const update = useUpdateEntity<PythonDistributionChanges, PythonDistribution>(
    pythonDistribution,
  );
  const { watch } = useWatchTask();
  const loaded = query.data;
  const read = useMemo(
    () => (loaded ? toForm(FIELDS, loaded) : undefined),
    [loaded],
  );
  const [edit, setEdit] = useState<Edit | null>(null);
  const values = edit?.values ?? read;
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  // A second press can arrive before the disabled button has rendered.
  const sending = useRef(false);

  const change = (field: string, value: unknown) => {
    if (!loaded || !values) {
      return;
    }
    setEdit((current) => ({
      values: { ...(current?.values ?? values), [field]: value },
      shown: current?.shown ?? loaded,
    }));
    setFailure(null);
  };

  const save = async () => {
    if (sending.current || !loaded || !values) {
      return;
    }
    sending.current = true;
    setFailure(null);
    try {
      const shown = edit?.shown ?? loaded;
      const changes = toRequest(
        FIELDS,
        values,
        changedNames(FIELDS, toForm(FIELDS, shown), values),
      ) as PythonDistributionChanges;

      if (Object.keys(changes).length === 0) {
        addAlert({
          variant: 'info',
          title: t`Nothing changed in distribution ${name}.`,
        });
        onClose();
        return;
      }

      const result = await update.mutateAsync({
        href: pulp_href,
        body: changes,
      });
      if (result.kind === 'task') {
        watch({
          href: result.task,
          label: t`Update of distribution ${name}`,
          resource: {
            app: pythonDistribution.app,
            object: pythonDistribution.object,
            href: pulp_href,
          },
        });
        addAlert(
          taskAlert(result.task, t`Update started for distribution ${name}`),
        );
      } else {
        addAlert({
          variant: 'success',
          title: t`Updated distribution ${name}`,
        });
      }
      onClose();
    } catch (error) {
      setFailure(saveFailure(error, SHOWN));
    } finally {
      sending.current = false;
    }
  };

  const failed = query.isError && !loaded && !isSessionEnd(query.error);
  const loadError = failed ? requestErrorText(query.error) : '';

  return (
    <Modal aria-labelledby={labelId} isOpen onClose={onClose} variant='small'>
      <ModalHeader labelId={labelId} title={t`Edit distribution`} />
      <ModalBody>
        <p>{name}</p>
        {failed ? (
          <Alert
            isInline
            variant='danger'
            title={t`Failed to load the distribution: ${loadError}`}
            actionLinks={
              <AlertActionLink onClick={() => void query.refetch()}>
                {t`Retry`}
              </AlertActionLink>
            }
          />
        ) : !loaded || !values ? (
          <Spinner size='md' />
        ) : (
          <DescriptorForm
            fields={FIELDS}
            values={values}
            errors={failure?.fields ?? {}}
            remotes={pythonRemote}
            failure={failure?.general}
            failureTitle={t`Distribution "${name}" could not be updated`}
            onChange={change}
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          key='save'
          variant='primary'
          onClick={save}
          isDisabled={!loaded || update.isPending}
        >
          {t`Save`}
          {update.isPending && <Spinner size='sm' />}
        </Button>
        <Button key='cancel' variant='link' onClick={onClose}>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
