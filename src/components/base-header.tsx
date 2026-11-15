import { Title } from '@patternfly/react-core';
import { type ReactNode, useEffect } from 'react';
import { useBreadcrumbSlot } from 'src/shell/breadcrumb-slot';
import './header.scss';

interface IProps {
  breadcrumbs?: ReactNode;
  children?: ReactNode;
  className?: string;
  contextSelector?: ReactNode;
  logo?: ReactNode;
  pageControls?: ReactNode;
  status?: ReactNode;
  subTitle?: ReactNode;
  title: string;
  versionControl?: ReactNode;
}

export const BaseHeader = ({
  title,
  logo,
  pageControls,
  children,
  breadcrumbs,
  className,
  contextSelector,
  versionControl,
  status,
  subTitle,
}: IProps) => {
  useEffect(() => {
    document.title = title ? `Pulp UI - ${title}` : 'Pulp UI';
  }, [title]);

  useBreadcrumbSlot(breadcrumbs, title);

  return (
    <div className={['pulp-header', className].filter(Boolean).join(' ')}>
      {contextSelector || null}

      <div className='pulp-header__row' data-cy='column-section'>
        <div className='pulp-header__title-box' data-cy='title-box'>
          {logo}
          <div>
            <Title headingLevel='h1' size='3xl'>
              {title}
              {status}
            </Title>
            {subTitle}
          </div>
        </div>
        {pageControls || null}
      </div>
      {versionControl || null}

      <div className={children ? 'pulp-header-bottom' : 'pulp-header__end'}>
        {children}
      </div>
    </div>
  );
};
