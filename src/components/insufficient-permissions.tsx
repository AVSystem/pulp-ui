import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import LockIcon from '@patternfly/react-icons/dist/esm/icons/lock-icon';
import { type ComponentPropsWithoutRef, type ElementType } from 'react';
import { Link, useNavigate } from 'react-router';
import { Paths, formatPath } from 'src/paths';
import { EmptyStateCustom } from './empty-state-custom';
import { Main } from './main';

// A module-level component, so the button keeps the same element between
// renders instead of being replaced each time.
const RouterLink = ({
  to,
  ...props
}: ComponentPropsWithoutRef<typeof Link>) => <Link {...props} to={to} />;

interface IProps {
  // The reason Pulp gave for refusing the read, shown as plain text. Left out
  // when the refusal carried none or was worked out without a request.
  detail?: string | null;
  // False when the screen draws a page header with the same title above the
  // page, so the document holds the title once. A screen that has a header of
  // its own with another title keeps the page's title.
  showTitle?: boolean;
}

// What a screen shows when the user may not view it. This is presentation
// only: Pulp decides who may read what, and a refused request is the answer
// that brings the user here. There is no retry, because asking again does not
// turn a refusal into permission. A visitor is never sent here: an address that
// needs a session leads to the sign-in page, so there is one page for everyone.
export const InsufficientPermissions = ({
  detail,
  showTitle = true,
}: IProps) => {
  const navigate = useNavigate();
  const startPage = formatPath(Paths.core.status);
  const text = typeof detail === 'string' ? detail.trim() : '';

  // Go back only when the app itself has an earlier entry; a page opened
  // directly has nothing to return to, so it goes to the start page instead.
  const goBack = () => {
    const index = window.history.state?.idx;
    if (typeof index === 'number' && index > 0) {
      navigate(-1);
    } else {
      navigate(startPage);
    }
  };

  const actions = (
    <>
      <Button variant='primary' onClick={goBack}>{t`Go back`}</Button>
      <Button
        component={RouterLink as ElementType}
        {...{ to: startPage }}
        variant='link'
      >{t`Go to the start page`}</Button>
    </>
  );

  return (
    <Main>
      <section
        className='pulp-section pulp-insufficient-permissions'
        data-cy='InsufficientPermissions'
        role='status'
      >
        <EmptyStateCustom
          icon={LockIcon}
          title={showTitle ? t`Insufficient permissions` : undefined}
          description={
            <>
              <p>{t`You do not have permission to view this page.`}</p>
              {text ? <p className='pulp-break-anywhere'>{text}</p> : null}
              <p>{t`Contact your organization administrator for more information.`}</p>
            </>
          }
          button={actions}
        />
      </section>
    </Main>
  );
};
