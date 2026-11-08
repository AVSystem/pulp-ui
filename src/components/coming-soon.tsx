import { t } from '@lingui/core/macro';
import WrenchIcon from '@patternfly/react-icons/dist/esm/icons/wrench-icon';
import { Link } from 'react-router';
import { BaseHeader } from './base-header';
import { EmptyStateCustom } from './empty-state-custom';
import { ExternalLink } from './external-link';
import { Main } from './main';

interface IProps {
  // The screen that does the same job on a plain Pulp server, if there is one.
  counterpart?: { label: string; to: string };
  // Documentation of the feature the screen stands for.
  docs: string;
  title: string;
}

// Stands in for a screen that is not available in this UI yet. Everything it
// shows comes from its props, never from the address it was opened at, and it
// sends no request.
export const ComingSoon = ({ counterpart, docs, title }: IProps) => (
  <>
    <BaseHeader title={title} />
    <Main>
      <section className='pulp-section'>
        <EmptyStateCustom
          icon={WrenchIcon}
          title={title}
          description={
            <>
              <p>{t`This screen is not available in this UI yet.`}</p>
              {counterpart ? (
                <p>
                  <Link to={counterpart.to}>{counterpart.label}</Link>
                </p>
              ) : null}
              <p>
                <ExternalLink href={docs}>{t`Pulp documentation`}</ExternalLink>
              </p>
            </>
          }
        />
      </section>
    </Main>
  </>
);
