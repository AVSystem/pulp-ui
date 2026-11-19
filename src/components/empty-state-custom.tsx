import {
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateVariant,
} from '@patternfly/react-core';
import { type ComponentClass, type ReactElement, type ReactNode } from 'react';

interface IProps {
  icon?: ComponentClass;
  // Left out when a header above the empty state already names the screen.
  title?: string;
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
      titleText={title}
      icon={icon}
      variant={EmptyStateVariant[variant]}
      data-cy='EmptyState'
    >
      <EmptyStateBody>{description}</EmptyStateBody>
      {button ? (
        <EmptyStateFooter>
          <EmptyStateActions>{button}</EmptyStateActions>
        </EmptyStateFooter>
      ) : null}
    </EmptyState>
  );
};
