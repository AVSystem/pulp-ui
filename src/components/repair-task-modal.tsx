import { t } from '@lingui/core/macro';
import {
  Button,
  Checkbox,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useId } from 'react';

interface IProps {
  cancelAction: () => void;
  confirmAction?: () => void;
  taskValue: { verify_checksums: boolean };
  updateTask: (t) => void;
}

export const RepairTaskModal = (props: IProps) => {
  const { cancelAction, confirmAction, taskValue, updateTask } = props;
  const labelId = useId();
  const descriptorId = useId();

  return (
    <Modal
      aria-describedby={descriptorId}
      aria-labelledby={labelId}
      isOpen
      onClose={cancelAction}
      variant='medium'
    >
      <ModalHeader
        description={t`Trigger an asynchronous task that checks for missing or corrupted artifacts, and attempts to redownload them.`}
        descriptorId={descriptorId}
        labelId={labelId}
        title={t`Repair task`}
        titleIconVariant='info'
      />
      <ModalBody>
        <Form>
          <FormGroup fieldId={'states'}>
            <Checkbox
              id={'verify_checksum'}
              isChecked={taskValue.verify_checksums}
              onChange={(_, value) => {
                {
                  updateTask({ verify_checksums: value });
                }
              }}
              label={t`Verify checksums`}
              description={t`Will verify that the checksum of all stored files matches what saved in the database. Otherwise only the existence of the files will be checked. Enabled by default.`}
            />
            <br />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button key='confirm' onClick={confirmAction} variant='primary'>
          {t`Yes`}
        </Button>
        <Button key='cancel' onClick={cancelAction} variant='link'>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
