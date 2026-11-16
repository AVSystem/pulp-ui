import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { Fragment, useEffect, useRef, useState } from 'react';
import { MaybeLink, Spinner, Tooltip } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { useSessionEpoch } from 'src/user-context';
import { plugin2api } from 'src/utilities';
import { isSessionEnd, requestErrorText } from 'src/utilities/request-error';

export const LazyRepositories = ({
  content_href,
  emptyText,
  plugin,
  remote_href,
}: {
  content_href?: string;
  emptyText?: string;
  plugin: 'ansible' | 'deb' | 'file' | 'python' | 'rpm';
  remote_href?: string;
}) => {
  const [repositories, setRepositories] = useState([]);
  const [count, setCount] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // grows when the same user signs in again, so the cell reads again
  const epoch = useSessionEpoch();

  // Every request takes a number; an answer whose number is not the latest
  // belongs to a remote, content or session state that is gone and is dropped.
  const latest = useRef(0);

  const query = (pageToLoad: number, prepend?: unknown[]) => {
    const read = ++latest.current;

    plugin2api(plugin)
      .RepositoryAPI.list({
        ...(content_href ? { with_content: content_href } : null),
        ...(remote_href ? { remote: remote_href } : null),
        page: pageToLoad,
        page_size: 10,
      })
      .then(({ data: { count, results } }) => {
        if (read !== latest.current) {
          return;
        }

        setRepositories(prepend ? [...prepend, ...results] : results);
        setCount(count);
        setPage(pageToLoad);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        // The session ended: the cell keeps its spinner or what it shows and
        // reads again after signing in, the sign-in dialog explains it.
        if (read !== latest.current || isSessionEnd(e)) {
          return;
        }

        setRepositories(prepend || []);
        setCount(null);
        setError(requestErrorText(e));
        setLoading(false);
      });
  };

  useEffect(() => {
    // answers of the state that is being left are dropped, also after unmount
    const leave = () => {
      latest.current += 1;
    };

    setRepositories([]);
    setCount(null);
    setPage(1);
    setError(null);

    if (!remote_href && !content_href) {
      setLoading(false);
      return leave;
    }

    setLoading(true);

    query(1);

    return leave;
  }, [content_href, remote_href, epoch]);

  const errorElement = error && (
    <Tooltip content={t`Failed to load repositories: ${error}`} key='empty'>
      <Button icon={<ExclamationCircleIcon />} variant='plain' />
    </Tooltip>
  );

  const loadMore = () => {
    query(page + 1, repositories);
  };

  const pluginPaths = Paths[plugin] as Record<string, Record<string, string>>;

  return loading ? (
    <Spinner size='sm' />
  ) : error ? (
    errorElement
  ) : (
    <>
      {repositories?.map?.(({ name, pulp_href }, index) => (
        <Fragment key={pulp_href ?? name}>
          {index ? ', ' : ''}
          <MaybeLink
            to={
              pluginPaths?.repository?.detail
                ? formatPath(pluginPaths.repository.detail, { name })
                : null
            }
          >
            {name}
          </MaybeLink>
        </Fragment>
      ))}
      {!repositories?.length ? (emptyText ?? '---') : null}
      {count > repositories?.length ? (
        <>
          {' '}
          <a onClick={loadMore}>{t`(more)`}</a>
        </>
      ) : null}
    </>
  );
};
