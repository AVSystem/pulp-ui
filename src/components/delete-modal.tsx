import { t } from '@lingui/core/macro';
import { Button, Modal, type ModalProps } from '@patternfly/react-core';
import { type ReactNode } from 'react';
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
  return (
    <Modal
      actions={[
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
        </div>,
        <Button
          key='cancel'
          onClick={cancelAction}
          variant='link'
          isDisabled={isCancelDisabled}
        >
          {t`Cancel`}
        </Button>,
      ]}
      isOpen
      onClose={isCancelDisabled ? undefined : cancelAction}
      showClose={!isCancelDisabled}
      title={title}
      titleIconVariant='warning'
      variant={variant}
      data-cy='modal_checkbox'
    >
      {children}
    </Modal>
  );
};
