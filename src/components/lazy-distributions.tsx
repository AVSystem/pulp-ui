import { t } from '@lingui/core/macro';
import { Button, Label } from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { Fragment, useEffect, useState } from 'react';
import { useSessionEpoch } from '../user-context';
import {
  type RepositoryDistribution,
  type RepositoryDistributionPlugin,
  distributionsLoadError,
  repositoryDistributions,
} from '../utilities/repository-distributions';
import { isSessionEnd } from '../utilities/request-error';
import { Spinner } from './patternfly-wrappers/l10n';
import { Tooltip } from './patternfly-wrappers/tooltip';

// The names of every distribution serving a repository, publication-bound
// ones included. A distribution the content app answers 404 for is flagged, so
// an editor does not take it for a working one.
export const LazyDistributions = ({
  emptyText,
  plugin,
  repositoryHref,
}: {
  emptyText?: string;
  plugin: RepositoryDistributionPlugin;
  repositoryHref: string;
}) => {
  const [distributions, setDistributions] = useState<RepositoryDistribution[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // grows when the same user signs in again, so the cell reads again
  const epoch = useSessionEpoch();

  useEffect(() => {
    setDistributions([]);
    setError(null);

    if (!repositoryHref) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // a response for a repository that is no longer shown must not replace
    // the current one
    let current = true;

    repositoryDistributions(plugin, repositoryHref)
      .then((result) => {
        if (current) {
          setDistributions(result);
          setLoading(false);
        }
      })
      .catch((e) => {
        // The session ended: the cell keeps its spinner and reads again after
        // signing in, the sign-in dialog explains the failure.
        if (current && !isSessionEnd(e)) {
          setError(distributionsLoadError(e));
          setLoading(false);
        }
      });

    return () => {
      current = false;
    };
  }, [plugin, repositoryHref, epoch]);

  if (loading) {
    return <Spinner size='sm' />;
  }

  if (error) {
    return (
      <Tooltip content={t`Failed to load distributions: ${error}`} key='empty'>
        <Button icon={<ExclamationCircleIcon />} variant='plain' />
      </Tooltip>
    );
  }

  if (!distributions.length) {
    return <>{emptyText ?? '---'}</>;
  }

  return (
    <>
      {distributions.map(({ pulp_href, name, served }, index) => (
        <Fragment key={pulp_href}>
          {index ? ', ' : null}
          {name}
          {served ? null : (
            <>
              {' '}
              <Label color='orange' isCompact>
                {t`Not served: no publication`}
              </Label>
            </>
          )}
        </Fragment>
      ))}
    </>
  );
};
