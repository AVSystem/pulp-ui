import { t } from '@lingui/core/macro';
import ExclamationTriangleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon';
import { EmptyStateCustom } from './empty-state-custom';
import { LoginLink } from './login-link';
import { Main } from './main';

// Shown instead of a second automatic redirect to the external login when the
// page came back from it without a signed-in session. Only the button leaves
// the page, so a login service that does not sign the user in cannot send the
// browser around in a loop.
export const ExternalSignInIncomplete = () => (
  <Main>
    <section className='pulp-section' role='status'>
      <EmptyStateCustom
        icon={ExclamationTriangleIcon}
        title={t`Sign-in did not complete`}
        description={
          <>
            <p>{t`The login page returned without a signed-in session.`}</p>
            <p>{t`Contact your organization administrator for more information.`}</p>
          </>
        }
        button={<LoginLink button />}
      />
    </section>
  </Main>
);
