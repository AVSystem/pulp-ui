import { t } from '@lingui/core/macro';
import { Button, Content } from '@patternfly/react-core';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  type AlertType,
  DateComponent,
  Details,
  EmptyStateCustom,
  ListErrorState,
  LoadingSpinner,
} from 'src/components';
import { versionNumberOf } from 'src/entities/href';
import type { RepositoryBase } from 'src/entities/plugin/model';
import {
  useRepositoryVersion,
  useRepositoryVersions,
} from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import {
  DeleteVersionDialog,
  protectionText,
} from '../content/delete-version-dialog';
import { useVersionProtection } from '../content/use-version-protection';
import { type PluginDescriptor, repositoryOf } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import { versionPath } from '../route-patterns';
import { useRepositoryPermission } from './use-repository-permission';
import { VersionContent } from './version-content';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  number: number;
  addAlert: (alert: AlertType) => void;
}

// One version of a repository, found by the number its address names: when it
// was made, what it added to the version before it, what it removed, the
// content it holds and the version it was made from. The number is only ever
// the value of a filter of the repository's versions list. A user who may
// delete the repository can delete the version here, unless the server would
// refuse: the reason is then written beside the disabled action.
export const VersionDetail = ({
  plugin,
  descriptor,
  repository,
  number,
  addAlert,
}: Props) => {
  const { entity } = repositoryOf(descriptor);
  const query = useRepositoryVersion(entity, repository.pulp_href, number);
  const version = query.data;
  const mayDelete = useRepositoryPermission(plugin, repository, 'delete');
  const [deleting, setDeleting] = useState(false);
  // One row of the list is enough to know how many versions there are.
  const count = useRepositoryVersions(entity, repository.pulp_href, {
    page: 1,
    page_size: 1,
  });
  const protection = useVersionProtection({
    plugin,
    descriptor,
    repository,
    versions: [number],
    totalVersions: count.data?.count,
  });
  const reasons = protection.reasonsOf(number);

  if (version === null) {
    return (
      <EmptyStateCustom
        title={t`Repository version not found`}
        description={t`This repository has no version ${number}.`}
      />
    );
  }
  if (!version) {
    // A session that ended keeps the spinner: the sign-in dialog explains it
    // and the read runs again afterwards.
    return query.isError && !isSessionEnd(query.error) && !query.isFetching ? (
      <ListErrorState
        title={t`Repository version could not be displayed.`}
        message={requestErrorDescription(query.error)}
        onRetry={() => query.refetch()}
      />
    ) : (
      <LoadingSpinner />
    );
  }

  const base = versionNumberOf(version.base_version);

  return (
    <div data-cy='VersionDetail'>
      {mayDelete ? (
        <div className='pf-v6-u-mb-md'>
          <Button
            variant='danger'
            isAriaDisabled={reasons.length > 0 || protection.pending}
            onClick={() => setDeleting(true)}
          >
            {t`Delete version`}
          </Button>
          {reasons.length > 0 ? (
            <Content component='small'>{protectionText(reasons)}</Content>
          ) : null}
        </div>
      ) : null}
      <Details
        fields={[
          { label: t`Version number`, value: version.number },
          {
            label: t`Created date`,
            value: <DateComponent date={version.pulp_created ?? ''} />,
          },
          {
            label: t`Base version`,
            value:
              base === null ? (
                t`None`
              ) : (
                <Link to={versionPath(plugin, repository.name, base)}>
                  {base}
                </Link>
              ),
          },
        ]}
      />
      <VersionContent descriptor={descriptor} version={version} />
      {deleting ? (
        <DeleteVersionDialog
          repository={repository}
          version={version}
          entity={entity}
          addAlert={addAlert}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </div>
  );
};
