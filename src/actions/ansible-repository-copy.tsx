import { msg, t } from '@lingui/core/macro';
import { AnsibleDistributionAPI } from '../api/ansible-distribution';
import { getDistroURL } from '../utilities/get-repo-url';
import {
  type Distribution,
  repositoryDistro,
} from '../utilities/repository-distro';
import { isSessionEnd } from '../utilities/request-error';
import { Action } from './action';

export const ansibleRepositoryCopyAction = Action({
  title: msg`Copy CLI configuration`,
  onClick: async (item, { addAlert }) => {
    let distro: Distribution | null;
    let sessionEnded = false;

    if (!item.distro) {
      addAlert({
        id: 'copy-cli-config',
        title: t`Loading distribution...`,
        variant: 'info',
      });

      distro = await repositoryDistro(
        item.name,
        item.pulp_href,
        AnsibleDistributionAPI,
      ).catch((e) => {
        sessionEnded = isSessionEnd(e);
        return null;
      });
    } else {
      distro = item.distro;
    }

    // The session ended while the distribution was read: the sign-in dialog
    // explains it, and nothing is copied until the user asks again.
    if (!distro && sessionEnded) {
      return;
    }

    if (!distro) {
      addAlert({
        id: 'copy-cli-config',
        title: t`There are no distributions associated with this repository.`,
        variant: 'danger',
      });
      return;
    }

    const cliConfig = [
      '[galaxy]',
      `server_list = ${distro.name}`,
      '',
      `[galaxy_server.${distro.name}]`,
      `url=${getDistroURL(distro)}`,
      'token=<put your token here>',
    ].join('\n');

    navigator.clipboard.writeText(cliConfig);
    addAlert({
      description: <pre>{cliConfig}</pre>,
      id: 'copy-cli-config',
      title: t`Successfully copied to clipboard`,
      variant: 'success',
    });
  },
  disabled: (item) => {
    // disabled check only available on detail screen
    if ('distro' in item && !item.distro) {
      return t`There are no distributions associated with this repository.`;
    }

    return null;
  },
});
