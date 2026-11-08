import { t } from '@lingui/core/macro';
import { type ComponentType, type JSX, Suspense, lazy } from 'react';
import { ListErrorState } from 'src/components/list-error-state';
import { LoadingPage } from 'src/components/loading-page';
import { Main } from 'src/components/main';
import { requestErrorText } from 'src/utilities/request-error';

// Shown in the place of a screen whose code could not be fetched, typically a
// tab left open across a new deployment: the files it names no longer exist.
// A rejected import is remembered by React, so trying the same import again
// cannot succeed; loading the page again fetches the files of the new build.
const ScreenLoadFailed = ({ error }: { error: unknown }) => (
  <Main>
    <section className='pulp-section'>
      <ListErrorState
        title={t`This screen could not be loaded`}
        message={requestErrorText(error)}
        actionLabel={t`Reload`}
        onRetry={() => window.location.reload()}
      />
    </section>
  </Main>
);

// A screen that is fetched when it is first shown. While the code arrives the
// loading page takes its place; when it cannot be fetched the user gets the
// reload state above instead of the error page of the router.
export function lazyScreen<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
): ComponentType<Props> {
  const Screen = lazy(() =>
    load().catch((error: unknown) => ({
      default: () => <ScreenLoadFailed error={error} />,
    })),
  ) as unknown as ComponentType<Props>;

  return function LazyScreen(props: Props) {
    return (
      <Suspense fallback={<LoadingPage />}>
        <Screen {...props} />
      </Suspense>
    );
  };
}
