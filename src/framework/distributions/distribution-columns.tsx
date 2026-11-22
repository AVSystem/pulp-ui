import { t } from '@lingui/core/macro';
import { Content, Label, Skeleton } from '@patternfly/react-core';
import { Link } from 'react-router';
import { CopyURL } from 'src/components';
import type { DistributionPlugin } from 'src/entities/core/distribution/page';
import { PLUGIN_MANIFESTS } from '../manifest';
import { repositoryPath } from '../route-patterns';
import { ServedLabel } from '../serving/served-label';
import type { ServedState } from '../serving/served-state';
import type { DistributionCells, Serves } from './use-distribution-columns';

// The cells of the derived columns of the distribution list: what a row serves,
// how it is protected and whether it works. A cell holds no request. Its row
// passes in what the shared reads say about it, with the state of those reads,
// so a column that is still loading or failed says so in every row instead of
// reading as "nothing".

const Placeholder = () => <Skeleton width='70%' />;

const NotLoaded = () => <>{t`Not loaded`}</>;

// The mark of a distribution that has no content guard: anyone who knows its
// address may download from it.
export const PublicLabel = () => (
  <Label color='blue' variant='outline'>{t`Public`}</Label>
);

// Whether the plugin has repository screens a name can link to.
function hasRepositoryScreens(plugin: DistributionPlugin): boolean {
  return (
    PLUGIN_MANIFESTS.find(
      (manifest) => manifest.plugin === plugin,
    )?.resources.includes('repository') ?? false
  );
}

// The address a client of the row's plugin reaches the distribution at, with
// the mark that it is public or the note that it is not: a guarded address
// cannot be opened in a browser, because the content app ignores the session
// and asks for credentials.
export const UrlCell = ({
  cells,
  ofPlugin,
}: {
  cells: DistributionCells;
  ofPlugin: boolean;
}) => {
  const { url, isPublic } = cells;

  if (!ofPlugin) {
    return <>{t`None`}</>;
  }
  if (url.state === 'loading') {
    return <Placeholder />;
  }
  if (url.state === 'error') {
    return <NotLoaded />;
  }
  if (!url.value) {
    return <>{t`None`}</>;
  }

  return (
    <>
      <CopyURL url={url.value} />
      {isPublic ? (
        <>
          {' '}
          <PublicLabel />
        </>
      ) : (
        <Content component='small'>
          {t`Downloads need credentials. The client snippet shows how.`}
        </Content>
      )}
    </>
  );
};

function servesText(serves: Serves): string {
  switch (serves.kind) {
    case 'publication': {
      const version = serves.version;
      return version === null
        ? t`A publication`
        : t`Publication of version ${version}`;
    }
    case 'version': {
      const number = serves.number;
      return number === null
        ? t`A pinned version`
        : t`Version ${number} (pinned)`;
    }
    default:
      return t`Nothing`;
  }
}

// What the distribution serves: its repository, with a link when the plugin has
// repository screens, the publication with its version, a pinned version, or
// nothing.
export const ServesCell = ({
  cells,
  plugin,
}: {
  cells: DistributionCells;
  plugin: DistributionPlugin | null;
}) => {
  const { state, value } = cells.serves;

  if (state === 'loading') {
    return <Placeholder />;
  }
  if (state === 'error' || value === null) {
    return <NotLoaded />;
  }
  if (value.kind !== 'repository') {
    return <>{servesText(value)}</>;
  }
  // A repository the user may not read has no name to show.
  if (value.name === null) {
    return <>{t`A repository you may not see`}</>;
  }

  return plugin !== null && hasRepositoryScreens(plugin) ? (
    <Link to={repositoryPath(plugin as never, value.name)}>{value.name}</Link>
  ) : (
    <>{value.name}</>
  );
};

// The content guard by name and kind, or the mark that there is none. A guard
// the user may not read shows no name.
export const GuardCell = ({ cells }: { cells: DistributionCells }) => {
  const { guard, isPublic } = cells;

  if (isPublic) {
    return <PublicLabel />;
  }
  if (guard.pending) {
    return <Placeholder />;
  }
  if (guard.name === null) {
    return <>{t`A content guard you may not see`}</>;
  }
  const kind = guard.kind?.replaceAll('_', ' ');

  return <>{kind ? `${guard.name} (${kind})` : guard.name}</>;
};

// What the distribution serves, as the rules of the served-state module tell:
// every state, so a working distribution reads as working and not as a blank
// cell.
const ServedStateLabel = ({ state }: { state: ServedState }) => {
  if (state.state === 'served') {
    return <Label color='green'>{t`Served`}</Label>;
  }
  if (state.state === 'not-applicable' && state.note === undefined) {
    return <>{t`Not applicable`}</>;
  }

  return <ServedLabel state={state} />;
};

export const ServedCell = ({ cells }: { cells: DistributionCells }) => {
  const { state, value } = cells.served;

  if (state === 'loading') {
    return <Placeholder />;
  }
  if (state === 'error') {
    return <NotLoaded />;
  }

  return value === null ? <>{t`None`}</> : <ServedStateLabel state={value} />;
};
