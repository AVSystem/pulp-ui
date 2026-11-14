import {
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateIcon,
  EmptyStateVariant,
} from '@patternfly/react-core';
import { type ComponentClass, type ReactElement, type ReactNode } from 'react';

interface IProps {
  icon?: ComponentClass;
  title: string;
  description: ReactNode;
  button?: ReactElement;
  variant?: 'xs' | 'small' | 'large' | 'xl' | 'full';
}

export const EmptyStateCustom = ({
  icon,
  title,
  description,
  button,
  variant = 'small',
}: IProps) => {
  return (
    <EmptyState
      headingLevel='h4'
      titleText={<>{title}</>}
      variant={EmptyStateVariant[variant]}
      data-cy='EmptyState'
    >
      {icon ? <EmptyStateIcon icon={icon} /> : null}
      <EmptyStateBody>{description}</EmptyStateBody>
      <EmptyStateFooter>
        {button && <EmptyStateActions>{button}</EmptyStateActions>}
      </EmptyStateFooter>
    </EmptyState>
  );
};
