import { t } from '@lingui/core/macro';
import { Content } from '@patternfly/react-core';
import { type ReactNode, useRef, useState } from 'react';
import { Alert, type AlertType } from 'src/components';
import { DeleteModal } from 'src/components/delete-modal';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useDeleteVersion } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorReason,
} from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';
import type { repositoryOf } from '../descriptor';
import { useWatchTask } from '../watched-tasks';
import type { ProtectionReason } from './protected-versions';

// How many distributions a reason names; the others are counted.
const NAMED = 3;

function namesOf(distributions: readonly string[]): string {
  const named = distributions
    .slice(0, NAMED)
    .map((name) => `"${name}"`)
    .join(', ');
  const others = distributions.length - NAMED;

  return others > 0 ? t`${named} and ${others} more` : named;
}

// Why a version cannot be deleted, in words, from what the distributions of the
// repository are bound to.
export function protectionText(reasons: readonly ProtectionReason[]): string {
  return reasons
    .map((reason) => {
      if (reason.kind === 'only-version') {
        return t`The only version of the repository.`;
      }
      const names = namesOf(reason.distributions);
      switch (reason.kind) {
        case 'version-bound':
          return t`A distribution is bound to this version: ${names}.`;
        case 'publication-bound':
          return t`A distribution is bound to a publication of this version: ${names}.`;
        case 'serves-published':
          return t`This is the newest published version, which a distribution bound to the repository serves: ${names}.`;
        case 'serves-latest':
          return t`This is the latest version, which a distribution bound to the repository serves: ${names}.`;
      }
    })
    .join(' ');
}

interface Props {
  repository: RepositoryBase;
  version: { pulp_href: string; number: number };
  // The plugin's repository entity; the action needs its version delete.
  entity: ReturnType<typeof repositoryOf>['entity'];
  addAlert: (alert: AlertType) => void;
  onClose: () => void;
}

// Asks for confirmation before a repository version is deleted. The server
// refuses a version a distribution serves, which the screens disable with the
// reason beforehand; whatever else it refuses is shown here as it was written
// and the dialog stays open. Otherwise it deletes the version, and the
// publications made from it, in a task of its own: the dialog closes once the
// server has accepted the request and an alert names the task. One
// confirmation sends one request; a request that was not sent because the
// session ended leaves the dialog open, so one more press sends it after
// signing in again.
export const DeleteVersionDialog = ({
  repository,
  version,
  entity,
  addAlert,
  onClose,
}: Props) => {
  const remove = useDeleteVersion(entity);
  const { watch } = useWatchTask();
  const sending = useRef(false);
  const [failure, setFailure] = useState<ReactNode | null>(null);
  const repositoryName = repository.name;
  const { number } = version;
  const isLatest = version.pulp_href === repository.latest_version_href;

  async function confirm() {
    if (sending.current) {
      return;
    }
    sending.current = true;
    setFailure(null);
    try {
      const task = await remove.mutateAsync({ href: version.pulp_href });
      // The root follows the task to its end wherever the user is by then; the
      // versions are read again then.
      watch({
        href: task,
        label: t`Deletion of version ${number} of ${repositoryName}`,
        resource: {
          app: entity.app,
          object: entity.object,
          href: repository.pulp_href,
        },
      });
      addAlert(
        taskAlert(
          task,
          t`Deletion started for version ${number} of repository "${repositoryName}".`,
        ),
      );
      onClose();
    } catch (error) {
      sending.current = false;
      if (!isSessionEnd(error)) {
        setFailure(requestErrorReason(error) ?? requestErrorDescription(error));
      }
    }
  }

  return (
    <DeleteModal
      spinner={remove.isPending}
      cancelAction={onClose}
      deleteAction={confirm}
      isCancelDisabled={remove.isPending}
      isDisabled={remove.isPending}
      title={t`Delete repository version?`}
      variant='medium'
    >
      <Content component='p'>
        {t`Delete version ${number} of repository "${repositoryName}"?`}
      </Content>
      <Content component='p'>
        {t`Publications made from this version are deleted with it. The content of the other versions does not change.`}
      </Content>
      {isLatest ? (
        <Content component='p'>
          {t`This is the latest version. The repository goes back to the newest version that is left.`}
        </Content>
      ) : null}
      {failure ? (
        <Alert
          isInline
          variant='danger'
          title={t`The version could not be deleted.`}
        >
          <span className='pulp-break-anywhere'>{failure}</span>
        </Alert>
      ) : null}
    </DeleteModal>
  );
};
