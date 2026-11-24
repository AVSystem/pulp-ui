import { t } from '@lingui/core/macro';
import {
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Spinner } from 'src/components';
import {
  DISTRIBUTION_ENTITIES,
  PUBLICATION_ENTITIES,
} from 'src/entities/core/distribution/page';
import { publicationRefKeys } from 'src/entities/core/publication/queries';
import { versionNumberOf } from 'src/entities/href';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import { useRepositoryPublications } from 'src/entities/plugin/publication';
import { entityKeys, useEntityList } from 'src/entities/plugin/queries';
import { requestErrorDescription } from 'src/utilities/request-error';
import type { BulkOutcome } from '../bulk/bulk-actions';
import { type PluginDescriptor, repositoryOf } from '../descriptor';
import { useDistributionPermission } from '../distributions/use-distribution-permission';
import type { FrameworkPlugin } from '../manifest';
import { distributionEditPath } from '../route-patterns';
import { type ServedState, servedPublication } from '../serving/served-state';
import { moveToPublication } from './pinned-distributions';
import { usePublishDescriptor } from './publish-descriptors';
import { PublishDialog } from './publish-dialog';
import { usePublishPermission } from './use-may-publish';

interface Props {
  plugin: FrameworkPlugin;
  // The distribution the warning is about. A version-bound one names the
  // version it is bound to, which the fix to publish it needs.
  distribution: {
    pulp_href: string;
    name: string;
    repository_version?: string | null;
  };
  served: ServedState;
  // The repository the distribution serves from, or the one its publication
  // was made from; null when it is not known, and then no fix that needs it is
  // offered.
  repositoryHref: string | null;
}

// The one-click fix beside a serving warning, for a user allowed to apply it. A
// warning that has none to offer (a state that cannot be checked, a plugin
// that serves versions directly) draws nothing, and neither does a fix the
// user may not apply: the warning alone is shown to them.
export const ServingFix = (props: Props) =>
  props.served.fix !== null && props.plugin in PUBLICATION_ENTITIES ? (
    <Fix {...props} fix={props.served.fix} />
  ) : null;

const Fix = ({
  plugin,
  distribution,
  repositoryHref,
  fix,
}: Props & { fix: NonNullable<ServedState['fix']> }) => {
  const mayPublish = usePublishPermission(plugin);
  const mayChange = useDistributionPermission(plugin, distribution, 'change');
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const boundVersion = versionNumberOf(distribution.repository_version);

  const trigger = (label: string) => (
    <Button variant='link' isInline onClick={() => setOpen(true)}>
      {label}
    </Button>
  );

  switch (fix) {
    case 'edit':
      return mayChange ? (
        <Link to={distributionEditPath(plugin, distribution.name)}>
          {t`Choose what it serves`}
        </Link>
      ) : null;
    case 'publish-latest':
      return mayPublish && repositoryHref ? (
        <>
          {trigger(t`Publish latest version`)}
          {open ? (
            <PublishFix
              plugin={plugin}
              distribution={distribution}
              repositoryHref={repositoryHref}
              version={null}
              onClose={close}
            />
          ) : null}
        </>
      ) : null;
    case 'publish-version':
      return mayPublish && repositoryHref && boundVersion !== null ? (
        <>
          {trigger(t`Publish version ${boundVersion}`)}
          {open ? (
            <PublishFix
              plugin={plugin}
              distribution={distribution}
              repositoryHref={repositoryHref}
              version={{
                number: boundVersion,
                pulp_href: distribution.repository_version as string,
              }}
              onClose={close}
            />
          ) : null}
        </>
      ) : null;
    default:
      return mayChange && repositoryHref ? (
        <>
          {trigger(t`Serve the newest publication`)}
          {open ? (
            <ServeNewestDialog
              plugin={plugin}
              distribution={distribution}
              repositoryHref={repositoryHref}
              onClose={close}
            />
          ) : null}
        </>
      ) : null;
  }
};

// A window that holds what the fix says while it reads what it needs.
const FixWindow = ({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) => {
  const labelId = useId();

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={onClose}
      variant='small'
      data-cy='ServingFix'
    >
      <ModalHeader labelId={labelId} title={title} />
      <ModalBody>{children}</ModalBody>
      <ModalFooter>
        {footer}
        <Button
          key='close'
          variant={footer ? 'link' : 'primary'}
          onClick={onClose}
        >
          {footer ? t`Cancel` : t`Close`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

// The publish dialog of the repository the distribution serves, opened with a
// line that names the distribution it repairs. The plugin's descriptor and the
// repository, which the dialog's options start from, are read when it opens.
const PublishFix = ({
  plugin,
  distribution,
  repositoryHref,
  version,
  onClose,
}: {
  plugin: FrameworkPlugin;
  distribution: Props['distribution'];
  repositoryHref: string;
  version: { number: number; pulp_href: string } | null;
  onClose: () => void;
}) => {
  const read = usePublishDescriptor(plugin);

  if (read.data) {
    return (
      <PublishFixOf
        descriptor={read.data}
        distribution={distribution}
        repositoryHref={repositoryHref}
        version={version}
        onClose={onClose}
      />
    );
  }

  return (
    <FixWindow title={t`Publish`} onClose={onClose}>
      {read.isError ? (
        <Alert
          isInline
          variant='danger'
          title={t`Publishing is not available.`}
        />
      ) : (
        <Spinner size='md' aria-label={t`Loading`} />
      )}
    </FixWindow>
  );
};

const PublishFixOf = ({
  descriptor,
  distribution,
  repositoryHref,
  version,
  onClose,
}: {
  descriptor: PluginDescriptor;
  distribution: Props['distribution'];
  repositoryHref: string;
  version: { number: number; pulp_href: string } | null;
  onClose: () => void;
}) => {
  const read = useEntityList(repositoryOf(descriptor).entity, {
    pulp_href__in: [repositoryHref],
    page_size: 1,
  });
  const repository = read.data?.results[0];
  const name = distribution.name;

  if (repository) {
    return (
      <PublishDialog
        descriptor={descriptor}
        repository={repository}
        version={version}
        onClose={onClose}
        intro={t`The distribution ${name} serves this repository through its publications, so it serves nothing new until one is made.`}
      />
    );
  }

  return (
    <FixWindow title={t`Publish`} onClose={onClose}>
      {read.isError || read.data ? (
        <Alert
          isInline
          variant='danger'
          title={t`The repository could not be read, so it cannot be published from here.`}
        >
          {read.isError ? requestErrorDescription(read.error) : null}
        </Alert>
      ) : (
        <Spinner size='md' aria-label={t`Loading`} />
      )}
    </FixWindow>
  );
};

// What became of the move, in words.
function movedText(outcome: BulkOutcome): { done: boolean; text: ReactNode } {
  switch (outcome.kind) {
    case 'succeeded':
      return { done: true, text: null };
    case 'failed':
    case 'skipped':
      return { done: false, text: outcome.reason };
    case 'started':
      return {
        done: false,
        text: t`The change was accepted and is still running.`,
      };
    case 'not-sent':
      return { done: false, text: t`The session ended before it was sent.` };
    default:
      return {
        done: false,
        text: t`The session ended while it was on its way.`,
      };
  }
}

// Asks, then makes the distribution serve the newest publication of the
// repository: one change that carries the new binding and null for each other
// binding the plugin's distribution has. The newest publication is the one a
// distribution bound to the repository would serve, so the distribution goes
// from a pinned older publication to what a repository binding would show.
const ServeNewestDialog = ({
  plugin,
  distribution,
  repositoryHref,
  onClose,
}: {
  plugin: FrameworkPlugin;
  distribution: Props['distribution'];
  repositoryHref: string;
  onClose: () => void;
}) => {
  const queryClient = useQueryClient();
  const publicationPlugin = plugin as keyof typeof PUBLICATION_ENTITIES;
  const publications = PUBLICATION_ENTITIES[publicationPlugin];
  const read = useRepositoryPublications(publications, repositoryHref);
  const newest = read.data
    ? servedPublication(
        { repository: repositoryHref },
        read.data.map((row) => ({
          pulp_href: row.pulp_href,
          repository_version: row.repository_version,
          version: versionNumberOf(row.repository_version),
          created: row.pulp_created,
        })),
      )
    : null;
  const [step, setStep] = useState<
    | { name: 'ask' }
    | { name: 'sending' }
    | { name: 'done'; outcome: BulkOutcome }
  >({ name: 'ask' });
  // A second press, before the first was answered or after it was, sends
  // nothing.
  const sent = useRef(false);
  const name = distribution.name;
  const version = newest?.version ?? null;

  const serve = async () => {
    if (sent.current || !newest) {
      return;
    }
    sent.current = true;
    setStep({ name: 'sending' });
    const [result] = await moveToPublication(
      DISTRIBUTION_ENTITIES[publicationPlugin] as never,
      [distribution as DistributionBase],
      newest.pulp_href,
      {},
    );
    const outcome = (result?.outcome ?? {
      kind: 'failed',
      reason: t`The result of the change could not be read.`,
    }) as BulkOutcome;
    // What serves what changed, for every screen that shows it.
    void queryClient.invalidateQueries({
      queryKey: entityKeys(DISTRIBUTION_ENTITIES[publicationPlugin]).all,
    });
    void queryClient.invalidateQueries({
      queryKey: entityKeys({ app: 'core', object: 'distribution' }).all,
    });
    void queryClient.invalidateQueries({ queryKey: publicationRefKeys.all });
    if (outcome.kind !== 'succeeded') {
      sent.current = false;
    }
    setStep({ name: 'done', outcome });
  };

  if (step.name === 'done') {
    const { done, text } = movedText(step.outcome);

    return (
      <FixWindow title={t`Serve the newest publication`} onClose={onClose}>
        {done ? (
          <Alert
            isInline
            variant='success'
            title={t`${name} now serves the newest publication.`}
          />
        ) : (
          <Alert
            isInline
            variant='danger'
            title={t`${name} could not be moved.`}
          >
            {text}
          </Alert>
        )}
      </FixWindow>
    );
  }

  return (
    <FixWindow
      title={t`Serve the newest publication`}
      onClose={onClose}
      footer={
        <Button
          key='serve'
          variant='primary'
          onClick={serve}
          isDisabled={!newest || step.name === 'sending'}
        >
          {t`Serve it`}
          {step.name === 'sending' ? <Spinner size='sm' /> : null}
        </Button>
      }
    >
      {read.isError ? (
        <Alert
          isInline
          variant='danger'
          title={t`The publications of this repository could not be read.`}
        >
          {requestErrorDescription(read.error)}
        </Alert>
      ) : !read.data ? (
        <Spinner size='md' aria-label={t`Loading`} />
      ) : version === null ? (
        <Content component='p'>
          {t`The repository has no publication to serve.`}
        </Content>
      ) : (
        <Content component='p'>
          {t`Serve the newest publication (version ${version}) from ${name}?`}
        </Content>
      )}
    </FixWindow>
  );
};
