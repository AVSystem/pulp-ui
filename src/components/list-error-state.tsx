import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { type ReactNode } from 'react';
import { EmptyStateCustom } from './empty-state-custom';

interface IProps {
  title: string;
  message: ReactNode;
  // The button text; "Retry" when omitted.
  actionLabel?: string;
  onRetry: () => void;
}

// Shown in the place of a list or detail body whose load failed: the reason
// and a button that loads again. It is never mistaken for an empty list.
export const ListErrorState = ({
  title,
  message,
  actionLabel,
  onRetry,
}: IProps) => (
  <EmptyStateCustom
    icon={ExclamationCircleIcon}
    title={title}
    description={message}
    button={
      <Button variant='primary' onClick={onRetry}>
        {actionLabel ?? t`Retry`}
      </Button>
    }
  />
);
