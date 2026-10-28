import { t } from '@lingui/core/macro';
import { Button, Label } from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { Fragment, useEffect, useState } from 'react';
import {
  type RepositoryDistribution,
  type RepositoryDistributionPlugin,
  distributionsLoadError,
  repositoryDistributions,
} from '../utilities/repository-distributions';
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
        if (current) {
          setError(distributionsLoadError(e));
          setLoading(false);
        }
      });

    return () => {
      current = false;
    };
  }, [plugin, repositoryHref]);

  if (loading) {
    return <Spinner size='sm' />;
  }

  if (error) {
    return (
      <Tooltip content={t`Failed to load distributions: ${error}`} key='empty'>
        <Button variant='plain'>
          <ExclamationCircleIcon />
        </Button>
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
