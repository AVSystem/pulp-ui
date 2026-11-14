import { t } from '@lingui/core/macro';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  type ModalProps,
} from '@patternfly/react-core';
import { type ReactNode, useId } from 'react';
import { Spinner } from 'src/components';

interface IProps {
  cancelAction: () => void;
  children?: ReactNode;
  deleteAction: () => void;
  // Keeps Cancel, the close button and Escape from closing the dialog, for a
  // dialog that must stay on screen until a running operation has reported.
  isCancelDisabled?: boolean;
  isDisabled?: boolean;
  isRemove?: boolean;
  title: string;
  spinner?: boolean;
  'data-cy'?: string;
  variant?: ModalProps['variant'];
}

export const DeleteModal = ({
  cancelAction,
  children,
  deleteAction,
  isCancelDisabled,
  isDisabled,
  isRemove,
  title,
  spinner,
  variant = 'small',
}: IProps) => {
  const labelId = useId();

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={isCancelDisabled ? undefined : cancelAction}
      variant={variant}
      data-cy='modal_checkbox'
    >
      <ModalHeader labelId={labelId} title={title} titleIconVariant='warning' />
      <ModalBody>{children}</ModalBody>
      <ModalFooter>
        <div data-cy='delete-button' key='delete'>
          <Button
            key='delete'
            onClick={deleteAction}
            variant='danger'
            isDisabled={isDisabled}
          >
            {isRemove ? t`Remove` : t`Delete`}
            {spinner && <Spinner size='sm' />}
          </Button>
        </div>
        <Button
          key='cancel'
          onClick={cancelAction}
          variant='link'
          isDisabled={isCancelDisabled}
        >
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
