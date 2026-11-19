import { t } from '@lingui/core/macro';
import { useAppContext } from 'src/app-context';
import { requestErrorDescription } from 'src/utilities/request-error';
import { BaseHeader } from './base-header';
import { ListErrorState } from './list-error-state';
import { Main } from './main';

// What a screen shows in its own place while the read of the signed-in user's
// permissions has failed: the reason and a button that reads them again. A
// failed read says nothing about what the user may do, so it is never shown as
// a refusal, and nothing the screen could offer is drawn on a guess.
export const PermissionsFailed = ({ title }: { title: string }) => {
  const { permissionsError, retryPermissions } = useAppContext();

  return (
    <>
      <BaseHeader title={title} />
      <Main>
        <section className='pulp-section'>
          <ListErrorState
            title={t`Your permissions could not be read`}
            message={requestErrorDescription(permissionsError)}
            onRetry={retryPermissions}
          />
        </section>
      </Main>
    </>
  );
};
