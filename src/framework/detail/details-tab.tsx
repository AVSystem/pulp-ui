import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Button, Skeleton } from '@patternfly/react-core';
import { Details } from 'src/components';
import { DistributionURL } from 'src/components/distribution-url';
import { useRepositoryDistributions } from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type { PluginDescriptor } from '../descriptor';
import { LabelEditor } from '../labels/label-editor';
import type { FrameworkPlugin } from '../manifest';
import { LastSync } from '../sync/last-sync';
import { RemoteReference } from './remote-reference';
import { useRepositoryPermission } from './use-repository-permission';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
}

// Where a repository is served: the URL each distribution that serves it
// reports, with the state of serving next to it. A read that failed says so and
// offers to read again, so a missing URL is never mistaken for none.
const RepositoryUrls = ({
  descriptor,
  repository,
}: Pick<Props, 'descriptor' | 'repository'>) => {
  const { distribution, publication } = descriptor;
  if (!distribution) {
    return <>{t`None`}</>;
  }

  return (
    <ServedAt
      descriptor={descriptor}
      repository={repository}
      distribution={distribution.entity}
      publication={publication}
    />
  );
};

const ServedAt = ({
  repository,
  distribution,
  publication,
}: Pick<Props, 'descriptor' | 'repository'> & {
  distribution: NonNullable<PluginDescriptor['distribution']>['entity'];
  publication: PluginDescriptor['publication'];
}) => {
  const serving = useRepositoryDistributions(
    distribution,
    publication,
    repository.pulp_href,
  );

  if (serving.status === 'error') {
    return (
      <>
        <span
          style={{
            color: 'var(--pf-t--global--text--color--status--danger--default)',
          }}
        >
          {t`Distributions could not be loaded`}
        </span>{' '}
        <Button variant='link' isInline onClick={serving.retry}>
          {t`Retry`}
        </Button>
      </>
    );
  }
  if (!serving.distributions) {
    return <Skeleton width='60%' />;
  }
  if (serving.distributions.length === 0) {
    return <>{t`None`}</>;
  }

  const many = serving.distributions.length > 1;

  return (
    <>
      {serving.distributions.map(({ row, served }) => (
        <div key={row.pulp_href}>
          {many ? <strong>{row.name}</strong> : null}
          <DistributionURL
            distribution={{ url: row.base_url ?? null, served }}
          />
        </div>
      ))}
    </>
  );
};

// The Details tab of a repository: the rows every repository has, with the
// rows the plugin adds after the description, and for a plugin that syncs, the
// last sync. The labels can be edited by a user who may change the repository.
export const DetailsTab = ({ plugin, descriptor, repository }: Props) => {
  const mayChange = useRepositoryPermission(plugin, repository, 'change');

  return (
    <Details
      fields={[
        { label: t`Repository name`, value: repository.name },
        { label: t`Description`, value: repository.description || t`None` },
        ...(descriptor.repository.detailRows ?? []).map(
          ({ label, render }) => ({
            label: i18n._(label),
            value: render(repository),
          }),
        ),
        {
          label: t`Repository URL`,
          value: (
            <RepositoryUrls descriptor={descriptor} repository={repository} />
          ),
        },
        {
          label: t`Labels`,
          value: (
            <LabelEditor
              object={repository}
              entity={descriptor.repository.entity}
              canEdit={mayChange}
            />
          ),
        },
        {
          label: t`Remote`,
          value: (
            <RemoteReference
              plugin={plugin}
              href={repository.remote}
              remote={descriptor.remote?.entity}
            />
          ),
        },
        ...(descriptor.repository.sync
          ? [
              {
                label: t`Last sync`,
                value: (
                  <LastSync repository={repository} descriptor={descriptor} />
                ),
              },
            ]
          : []),
      ]}
    />
  );
};
