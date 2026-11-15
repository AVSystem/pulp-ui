import { t } from '@lingui/core/macro';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { type ReactNode, useId } from 'react';
import { Spinner } from 'src/components';

interface IProps {
  cancelAction: () => void;
  children?: ReactNode;
  confirmAction?: () => void;
  isDisabled?: boolean;
  title: string;
  spinner?: boolean;
  confirmButtonTitle?: string;
}

export const ConfirmModal = (props: IProps) => {
  const {
    cancelAction,
    children,
    confirmAction,
    isDisabled,
    title,
    spinner,
    confirmButtonTitle,
  } = props;
  const labelId = useId();

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={cancelAction}
      variant='small'
    >
      <ModalHeader labelId={labelId} title={title} titleIconVariant='warning' />
      <ModalBody>{children}</ModalBody>
      <ModalFooter>
        <Button
          key='confirm'
          onClick={confirmAction}
          variant='primary'
          isDisabled={isDisabled}
        >
          {confirmButtonTitle ? confirmButtonTitle : t`Yes`}
          {spinner && <Spinner size='sm' />}
        </Button>
        <Button key='cancel' onClick={cancelAction} variant='link'>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
