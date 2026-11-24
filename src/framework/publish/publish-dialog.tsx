import { t } from '@lingui/core/macro';
import {
  AlertActionLink,
  Button,
  Checkbox,
  Content,
  Form,
  FormGroup,
  Label,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Spinner } from 'src/components';
import { versionNumberOf } from 'src/entities/href';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import { useDistributionIndex } from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type { PublishBody } from 'src/entities/plugin/publication';
import { entityKeys, usePublish } from 'src/entities/plugin/queries';
import type { BulkOutcome, BulkResult } from '../bulk/bulk-actions';
import type {
  DistributionKind,
  PluginDescriptor,
  PublicationKind,
} from '../descriptor';
import { saveFailure } from '../form/save-errors';
import { OptionField, initialValues } from '../sync/sync-dialog';
import { readTaskToEnd } from '../task-end';
import { useWatchTask } from '../watched-tasks';
import { moveToPublication, pinnedToOlder } from './pinned-distributions';

// The version a publish is made from: its number, which names it for the user,
// and its address, which the request sends.
export interface PublishVersion {
  number: number;
  pulp_href: string;
}

interface Props {
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  // The version to publish; without one the repository's latest version is
  // published.
  version?: PublishVersion | null;
  // Called when the dialog is to go away: after a publish was accepted, or when
  // the user closes it. It cannot be closed while the request is on its way.
  onClose: () => void;
  // Called once, with the address of the task, when the server has accepted the
  // publish and before the dialog closes.
  onStarted?: (task: string) => void;
}

// What happens after the server accepted a publish for which the user chose
// distributions to move.
type After =
  // nothing yet: the form is shown
  | { step: 'form' }
  // the task is read until it ends
  | { step: 'waiting' }
  // the publication exists and the distributions are being moved
  | { step: 'moving' }
  // every move has ended, with its own result
  | { step: 'moved'; results: BulkResult<DistributionBase>[] }
  // no distribution was moved, and why
  | { step: 'not-moved'; reason: string };

// The dialog that starts a publish of one repository: its latest version or
// one version, with the options of the plugin. The options start from what the
// server would use, and only an option the user changed is sent.
//
// The dialog lists the repository's distributions that are bound to an older
// publication, each unticked. When none is ticked the dialog closes as soon as
// the server has accepted the request; the task is followed to its end by the
// application root, wherever the user is by then, and its progress is shown by
// the repository's own screen. When some are ticked the dialog stays, waits for
// the task and moves exactly the ticked ones to the new publication, then shows
// what became of each.
export const PublishDialog = (props: Props) => {
  const { publication, distribution } = props.descriptor;
  if (!publication || !distribution) {
    return null;
  }

  return (
    <PublishDialogScreen
      {...props}
      kind={publication}
      distribution={distribution}
    />
  );
};

const PublishDialogScreen = ({
  repository,
  version = null,
  onClose,
  onStarted,
  kind,
  distribution,
}: Props & {
  kind: PublicationKind;
  distribution: DistributionKind<DistributionBase>;
}) => {
  const labelId = useId();
  const queryClient = useQueryClient();
  const { name } = repository;
  const options = kind.options ?? [];
  // What the options hold before the user touches them, kept for the life of
  // the dialog: it is what an option is compared with to tell whether the user
  // changed it.
  const [initial] = useState(() => initialValues(options, repository));
  const [values, setValues] = useState(initial);
  const start = usePublish<PublishBody>(kind.entity);
  const { watch } = useWatchTask();
  // Pressing Publish twice before the screen has drawn the first press must
  // still send one request, and so must a press after the server accepted the
  // first: the dialog is about to go away, and a second publish would make a
  // second publication.
  const sent = useRef(false);

  // The distributions that keep serving an older publication, and which of
  // them the user chose to move.
  const published =
    version?.number ?? versionNumberOf(repository.latest_version_href);
  const index = useDistributionIndex(distribution.entity, kind.entity);
  const { distributionsOfRepository, publicationVersions } = index;
  const pinned = useMemo(() => {
    const own = distributionsOfRepository(repository.pulp_href);
    return own && publicationVersions && published !== null
      ? pinnedToOlder(own, publicationVersions, published)
      : [];
  }, [
    distributionsOfRepository,
    publicationVersions,
    repository.pulp_href,
    published,
  ]);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [after, setAfter] = useState<After>({ step: 'form' });

  // A wait that outlives the dialog is stopped: nothing is moved for a dialog
  // that is gone.
  const waiting = useRef(new AbortController());
  useEffect(() => {
    const controller = waiting.current;
    return () => controller.abort();
  }, []);

  const failure = start.isError ? saveFailure(start.error, []) : null;
  const number = version?.number;

  const tick = useCallback((href: string, checked: boolean) => {
    setTicked((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(href);
      } else {
        next.delete(href);
      }
      return next;
    });
  }, []);

  // Waits for the publish to end, then moves the chosen distributions to the
  // publication it made.
  const moveAfter = async (task: string, chosen: DistributionBase[]) => {
    const { signal } = waiting.current;
    setAfter({ step: 'waiting' });
    const end = await readTaskToEnd(task, { signal });
    if (signal.aborted || end.state === 'pending') {
      return;
    }
    if (end.state === 'failed') {
      const reason = end.reason;
      setAfter({
        step: 'not-moved',
        reason: t`The publish failed: ${reason} No distribution was moved.`,
      });
      return;
    }
    const made =
      end.state === 'completed'
        ? end.created.find((href) => href.includes('/publications/'))
        : undefined;
    if (!made) {
      setAfter({
        step: 'not-moved',
        reason:
          end.state === 'completed'
            ? t`The publish finished, but the new publication could not be found. No distribution was moved.`
            : t`The progress of the publish could not be followed. No distribution was moved.`,
      });
      return;
    }

    setAfter({ step: 'moving' });
    const results = await moveToPublication(distribution.entity, chosen, made, {
      signal,
    });
    // What serves what changed, for every screen that shows it.
    void queryClient.invalidateQueries({
      queryKey: entityKeys(distribution.entity).all,
    });
    void queryClient.invalidateQueries({
      queryKey: entityKeys({ app: 'core', object: 'distribution' }).all,
    });
    if (!signal.aborted) {
      setAfter({ step: 'moved', results });
    }
  };

  const send = async () => {
    if (sent.current) {
      return;
    }
    sent.current = true;

    // The version or the repository, and what the user changed: an option left
    // as it started is left to the server, which takes it from the repository.
    const body: PublishBody = {
      ...(version
        ? { repository_version: version.pulp_href }
        : { repository: repository.pulp_href }),
      ...Object.fromEntries(
        options
          .filter(({ name: option }) => values[option] !== initial[option])
          .map(({ name: option }) => [option, values[option]]),
      ),
    };

    try {
      const task = await start.mutateAsync({
        repository: repository.pulp_href,
        body,
      });
      // The root follows the task to its end wherever the user is by then, and
      // reads the plugin's publications again when it has ended.
      watch({
        href: task,
        label:
          number === undefined
            ? t`Publish of ${name}`
            : t`Publish of version ${number} of ${name}`,
        resource: {
          app: kind.entity.app,
          object: kind.entity.object,
          href: repository.pulp_href,
        },
      });
      onStarted?.(task);
      const chosen = pinned.filter(({ pulp_href }) => ticked.has(pulp_href));
      if (chosen.length === 0) {
        onClose();
        return;
      }
      await moveAfter(task, chosen);
    } catch {
      // The failure is on the mutation and shown in the dialog, which stays
      // open with the options as they were, so Publish may be pressed again.
      sent.current = false;
    }
  };

  const moving = after.step === 'moving';
  const close = () => {
    if (!start.isPending && !moving) {
      onClose();
    }
  };

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={close}
      variant='medium'
      data-cy='PublishDialog'
    >
      <ModalHeader
        labelId={labelId}
        title={
          number === undefined
            ? t`Publish repository "${name}"`
            : t`Publish version ${number} of "${name}"`
        }
      />
      <ModalBody>
        {after.step === 'form' ? (
          <>
            {failure ? (
              <Alert
                isInline
                variant='danger'
                title={t`Failed to publish repository "${name}"`}
              >
                {failure.general}
              </Alert>
            ) : null}
            <Form
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              {options.map((option) => (
                <OptionField
                  key={option.name}
                  option={option}
                  repository={repository}
                  value={values[option.name]}
                  isDisabled={start.isPending}
                  onChange={(value) =>
                    setValues((current) => {
                      const next = { ...current, [option.name]: value };
                      return kind.adjust
                        ? kind.adjust(next, option.name)
                        : next;
                    })
                  }
                />
              ))}
              <PinnedList
                status={index.status}
                retry={index.retry}
                pinned={pinned}
                publicationVersions={publicationVersions}
                ticked={ticked}
                isDisabled={start.isPending}
                onTick={tick}
              />
            </Form>
          </>
        ) : null}
        {after.step === 'waiting' ? (
          <Content component='p'>
            <Spinner size='sm' />{' '}
            {t`The publish was accepted and is running. The distributions you chose are moved to the new publication when it exists. If you close this window now, they stay where they are.`}
          </Content>
        ) : null}
        {after.step === 'moving' ? (
          <Content component='p'>
            <Spinner size='sm' />{' '}
            {t`Moving the distributions to the new publication.`}
          </Content>
        ) : null}
        {after.step === 'not-moved' ? (
          <Alert isInline variant='danger' title={t`Nothing was moved`}>
            {after.reason}
          </Alert>
        ) : null}
        {after.step === 'moved' ? (
          <MoveResults results={after.results} />
        ) : null}
      </ModalBody>
      <ModalFooter>
        {after.step === 'form' ? (
          <Button
            key='publish'
            onClick={send}
            variant='primary'
            isDisabled={start.isPending}
          >
            {t`Publish`}
            {start.isPending ? <Spinner size='sm' /> : null}
          </Button>
        ) : null}
        <Button
          key='close'
          onClick={close}
          variant={after.step === 'form' ? 'link' : 'primary'}
          isDisabled={moving}
        >
          {t`Close`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

interface PinnedListProps {
  status: 'pending' | 'error' | 'success';
  retry: () => void;
  pinned: DistributionBase[];
  publicationVersions: ReadonlyMap<string, number | null> | undefined;
  ticked: ReadonlySet<string>;
  isDisabled: boolean;
  onTick: (href: string, checked: boolean) => void;
}

// The distributions that keep serving an older publication, each with a box
// that is not ticked: a distribution moves only when the user says so.
const PinnedList = ({
  status,
  retry,
  pinned,
  publicationVersions,
  ticked,
  isDisabled,
  onTick,
}: PinnedListProps) => {
  if (status === 'pending') {
    return (
      <Content component='p'>
        <Spinner size='sm' />{' '}
        {t`Looking for distributions that serve an older publication.`}
      </Content>
    );
  }
  if (status === 'error') {
    return (
      <Alert
        isInline
        variant='info'
        title={t`The distributions of this repository could not be read, so none can be moved from here. You can still publish.`}
        actionLinks={
          <AlertActionLink onClick={retry}>{t`Retry`}</AlertActionLink>
        }
      />
    );
  }
  if (pinned.length === 0) {
    return null;
  }

  return (
    <FormGroup
      role='group'
      label={t`Serve the new publication`}
      fieldId='pinned-distributions'
    >
      <Content component='small'>
        {t`These distributions are bound to an older publication and keep serving it. Tick the ones that should serve the new publication.`}
      </Content>
      {pinned.map((row) => {
        const bound = publicationVersions?.get(row.publication ?? '');
        return (
          <Checkbox
            key={row.pulp_href}
            id={`pinned-${row.pulp_href}`}
            label={row.name}
            description={t`Serves the publication of version ${bound}`}
            isChecked={ticked.has(row.pulp_href)}
            isDisabled={isDisabled}
            onChange={(_event, checked) => onTick(row.pulp_href, checked)}
          />
        );
      })}
    </FormGroup>
  );
};

// What became of one move, in words.
function resultOf(outcome: BulkOutcome): { label: string; detail: string } {
  switch (outcome.kind) {
    case 'succeeded':
      return { label: t`Moved`, detail: t`Now serves the new publication.` };
    case 'failed':
    case 'skipped':
      return { label: t`Failed`, detail: outcome.reason };
    case 'not-sent':
      return {
        label: t`Not sent`,
        detail: t`The session ended before this one was sent.`,
      };
    case 'started':
      return {
        label: t`Started`,
        detail: t`The change is still running.`,
      };
    default:
      return {
        label: t`Not confirmed`,
        detail: t`The session ended while this one was on its way.`,
      };
  }
}

// The result of every move, each distribution named with what became of it.
const MoveResults = ({
  results,
}: {
  results: BulkResult<DistributionBase>[];
}) => {
  const failed = results.filter(({ outcome }) => outcome.kind !== 'succeeded');
  const count = results.length;
  const lost = failed.length;
  const title =
    lost === 0
      ? t`${count} distributions now serve the new publication.`
      : t`${lost} of ${count} distributions could not be moved.`;

  return (
    <>
      <Alert
        isInline
        variant={lost === 0 ? 'success' : 'danger'}
        title={title}
      />
      <List isPlain aria-label={t`Result of each move`}>
        {results.map(({ target, outcome }) => {
          const { label, detail } = resultOf(outcome);
          return (
            <ListItem key={target.pulp_href}>
              <Label color={outcome.kind === 'succeeded' ? 'green' : 'red'}>
                {label}
              </Label>{' '}
              <strong>{target.name}</strong> {detail}
            </ListItem>
          );
        })}
      </List>
    </>
  );
};
