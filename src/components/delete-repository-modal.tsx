import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Alert, FormGroup, Text, TextInput } from '@patternfly/react-core';
import { useState } from 'react';
import { type DeleteRepositoryResult } from '../utilities/delete-repository';
import { DeleteModal } from './delete-modal';

interface IProps {
  closeAction: () => void;
  // Resolves with what was removed. The caller closes the dialog when the
  // repository is gone; a repository that was kept stays on screen here.
  deleteAction: () => Promise<DeleteRepositoryResult>;
  name: string;
}

export const DeleteRepositoryModal = ({
  closeAction,
  deleteAction,
  name,
}: IProps) => {
  const [deleting, setDeleting] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [kept, setKept] = useState<DeleteRepositoryResult | null>(null);

  if (!name) {
    return null;
  }

  return (
    <DeleteModal
      spinner={deleting}
      cancelAction={closeAction}
      deleteAction={async () => {
        setDeleting(true);
        try {
          const result = await deleteAction();
          setKept(result.repositoryDeleted ? null : result);
        } finally {
          setDeleting(false);
        }
      }}
      isDisabled={deleting || typedName !== name}
      title={t`Delete repository?`}
    >
      <Text>
        <Trans>
          Are you sure you want to delete the repository <b>{name}</b>?<br />
          <b>Note:</b> This will also delete all associated resources under this
          repository.
        </Trans>
      </Text>
      <FormGroup
        fieldId='delete-repository-name'
        label={t`Type the repository name to confirm`}
      >
        <TextInput
          id='delete-repository-name'
          isDisabled={deleting}
          onChange={(_event, value) => setTypedName(value)}
          type='text'
          value={typedName}
        />
      </FormGroup>
      {kept ? (
        <Alert isInline title={t`The repository was kept.`} variant='danger' />
      ) : null}
    </DeleteModal>
  );
};
