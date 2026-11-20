import { t } from '@lingui/core/macro';
import { Button, Skeleton } from '@patternfly/react-core';
import { Link } from 'react-router';
import { remoteLookup } from 'src/entities/core/remote/client';
import { useRemoteByHref } from 'src/entities/plugin/queries';
import type { RemoteEntity } from 'src/entities/plugin/remote';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';
import { remotePath } from '../route-patterns';

interface Props {
  plugin: FrameworkPlugin;
  // The address of the repository's remote, if it has one.
  href: string | null | undefined;
  // The plugin's own remote entity, when the plugin has one.
  remote: Pick<RemoteEntity<unknown, never, never>, 'urlOf'> | undefined;
}

// Whether the remote at this address is one the plugin has screens for: the
// plugin lists remotes among its resources and the address belongs to the
// plugin's own remote type. A repository can use a remote of another type (a
// git remote of a file repository, a ULN remote of an rpm repository); that
// remote has a name to show and no page to link to.
function hasScreens(
  plugin: FrameworkPlugin,
  href: string,
  remote: Props['remote'],
): boolean {
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  );
  if (!remote || !manifest?.resources.includes('remote')) {
    return false;
  }
  const listPath = remote.urlOf().split('?')[0] as string;

  return href.startsWith(listPath);
}

// The Remote row of a repository's details: the remote's name, linked to its
// page when the plugin has one for that type of remote. The name comes from one
// read of the list of every plugin's remotes by address, so a remote of any
// type is named; an address the list does not hold (a remote the user may not
// see) is said to be not available rather than shown as an address.
export const RemoteReference = ({ plugin, href, remote }: Props) => {
  const found = useRemoteByHref(remoteLookup, href ?? null);

  if (!href) {
    return <>{t`None`}</>;
  }
  if (found.isError) {
    return (
      <>
        {t`Remote could not be loaded`}{' '}
        <Button variant='link' isInline onClick={() => void found.refetch()}>
          {t`Retry`}
        </Button>
      </>
    );
  }
  if (!found.data) {
    return found.isSuccess ? <>{t`Not available`}</> : <Skeleton width='40%' />;
  }

  const { name } = found.data;

  return hasScreens(plugin, href, remote) ? (
    <Link to={remotePath(plugin, name)}>{name}</Link>
  ) : (
    <>{name}</>
  );
};
