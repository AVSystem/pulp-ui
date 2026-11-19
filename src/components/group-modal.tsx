import { t } from '@lingui/core/macro';
import {
  Button,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';
import { useId, useState } from 'react';
import { FormFieldHelper } from 'src/components';
import { type ErrorMessagesType } from 'src/utilities/map-error-messages';

interface IProps {
  clearErrors?: () => void;
  errorMessage?: ErrorMessagesType;
  group?: { name: string };
  onCancel?: () => void;
  onSave?: (string) => void;
}

export const GroupModal = ({
  clearErrors,
  errorMessage,
  group,
  onCancel,
  onSave,
}: IProps) => {
  const [name, setName] = useState<string>(group?.name || '');
  const labelId = useId();
  const nameError = errorMessage?.name;
  // what belongs to no field, such as a refused save
  const generalError = errorMessage?.['__nofield'];

  return (
    <Modal
      aria-labelledby={labelId}
      variant='medium'
      onClose={() => {
        onCancel();
      }}
      isOpen
    >
      <ModalHeader labelId={labelId} title={t`Create a group`} />
      <ModalBody>
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name);
          }}
        >
          <FormGroup isRequired key='name' fieldId='name' label={t`Name`}>
            <TextInput
              id='group_name'
              value={name}
              onChange={(_event, value) => {
                setName(value);
                clearErrors();
              }}
              type='text'
              validated={nameError ? 'error' : 'default'}
            />
            <FormFieldHelper variant={nameError ? 'error' : 'default'}>
              {nameError}
            </FormFieldHelper>
          </FormGroup>
          {generalError ? (
            <p
              className='pulp-break-anywhere'
              style={{
                color:
                  'var(--pf-t--global--text--color--status--danger--default)',
              }}
            >
              {generalError}
            </p>
          ) : null}
        </Form>
      </ModalBody>
      <ModalFooter>
        <div key='create' data-cy='create-group-button'>
          <Button
            isDisabled={name.length === 0 || (group && name === group.name)}
            key='create'
            variant='primary'
            onClick={() => onSave(name)}
          >
            {!group ? t`Create` : t`Save`}
          </Button>
        </div>
        <Button key='cancel' variant='link' onClick={() => onCancel()}>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
