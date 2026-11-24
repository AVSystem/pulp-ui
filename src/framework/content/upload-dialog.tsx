import { plural, t } from '@lingui/core/macro';
import {
  AlertActionLink,
  Button,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MultipleFileUpload,
  MultipleFileUploadMain,
  Progress,
  TextInput,
} from '@patternfly/react-core';
import UploadIcon from '@patternfly/react-icons/dist/esm/icons/upload-icon';
import { Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useAppContext } from 'src/app-context';
import { Alert, Spinner, Table } from 'src/components';
import { taskKeys } from 'src/entities/core/task/queries';
import {
  type UploadProgress,
  isChunked,
} from 'src/entities/core/upload/upload-file';
import {
  type AddOutcome,
  type UploadOutcome,
  uploadFiles,
} from 'src/entities/core/upload/upload-files';
import type { UploadableContent } from 'src/entities/plugin/content';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { entityKeys } from 'src/entities/plugin/queries';
import { getHumanSize } from 'src/utilities/get-human-size';
import type { ContentTypeDef, UploadDef, repositoryOf } from '../descriptor';
import { type TaskEnd, readTaskToEnd } from '../task-end';
import { useWatchTask } from '../watched-tasks';

// How many tasks the dialog reads at once while it waits for the server to
// finish the files it has been sent.
const TASKS_AT_ONCE = 4;

type Entity = ReturnType<typeof repositoryOf>['entity'];

interface Props {
  // The repository the files go into.
  repository: RepositoryBase;
  // The plugin's repository entity: it adds the content of the files when an
  // administrator uploads several files into one version.
  entity: Entity;
  // The kinds of content the plugin's repositories hold; the upload names the
  // one that is made from files.
  types: readonly ContentTypeDef[];
  upload: UploadDef;
  onClose: () => void;
}

// A file the user chose, with the path it will have in the repository.
interface Entry {
  id: number;
  file: File;
  path: string;
}

// What is known of one file while the upload runs.
interface Progressed {
  progress?: UploadProgress;
  outcome?: UploadOutcome;
  // How the task that made the file's content ended, when the dialog waited
  // for it.
  end?: TaskEnd;
}

interface Adding {
  outcome?: AddOutcome;
  end?: TaskEnd;
}

// What the user is told about one file.
type Status =
  | { kind: 'uploading' }
  | { kind: 'waiting-task' }
  | { kind: 'waiting-others' }
  | { kind: 'adding' }
  | { kind: 'added' }
  | { kind: 'not-added' }
  | { kind: 'failed'; reason: string }
  | { kind: 'not-confirmed'; reason: string }
  | { kind: 'canceled' }
  | { kind: 'not-sent' };

// Why a path cannot be sent, or null when it can. Anything else about a path is
// the server's to refuse, and its reason is shown for the file.
function pathProblem(path: string): string | null {
  if (path.trim() === '') {
    return t`Enter a relative path.`;
  }
  if (path.startsWith('/')) {
    return t`The path must not start with a slash.`;
  }
  return null;
}

function notConfirmed(end: TaskEnd | undefined): Status {
  if (end?.state === 'unconfirmed') {
    return {
      kind: 'not-confirmed',
      reason: t`The session ended before the result was known.`,
    };
  }
  if (end?.state === 'unknown') {
    return {
      kind: 'not-confirmed',
      reason: t`The file was sent, but its task could not be read.`,
    };
  }
  return {
    kind: 'not-confirmed',
    reason: t`The file was sent, but the dialog stopped waiting for it. It may still be added.`,
  };
}

// What became of the task that makes or adds content, for a file that waits for
// it. `waiting` is the status while the task has not ended.
function statusOfTask(
  end: TaskEnd | undefined,
  waiting: Status,
  finished: boolean,
): Status {
  if (!end) {
    return finished ? notConfirmed({ state: 'pending' }) : waiting;
  }
  if (end.state === 'completed') {
    return { kind: 'added' };
  }
  if (end.state === 'failed') {
    return { kind: 'failed', reason: end.reason };
  }
  return notConfirmed(end);
}

function statusOf(
  result: Progressed | undefined,
  adding: Adding,
  finished: boolean,
): Status {
  const outcome = result?.outcome;
  if (!outcome) {
    return finished ? { kind: 'not-sent' } : { kind: 'uploading' };
  }

  switch (outcome.kind) {
    case 'started':
      return statusOfTask(result.end, { kind: 'waiting-task' }, finished);
    case 'created':
      if (!adding.outcome) {
        return finished ? { kind: 'not-added' } : { kind: 'waiting-others' };
      }
      if (adding.outcome.kind === 'failed') {
        return { kind: 'failed', reason: adding.outcome.reason };
      }
      if (adding.outcome.kind === 'unconfirmed') {
        return notConfirmed({ state: 'unconfirmed' });
      }
      return statusOfTask(adding.end, { kind: 'adding' }, finished);
    case 'no-content':
      return {
        kind: 'failed',
        reason: t`The server did not make any content from this file.`,
      };
    case 'failed':
      return { kind: 'failed', reason: outcome.reason };
    case 'unfinished':
      return {
        kind: 'not-confirmed',
        reason: t`The server was still working on this file when the wait ended.`,
      };
    case 'canceled':
      return { kind: 'canceled' };
    case 'not-sent':
      return { kind: 'not-sent' };
    default:
      return notConfirmed({ state: 'unconfirmed' });
  }
}

// At most `max` jobs run at once; the others wait their turn.
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async <T,>(job: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await job();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

const isUploadable = (
  entity: ContentTypeDef['entity'],
): entity is UploadableContent<{ pulp_href: string }> =>
  typeof (entity as Partial<UploadableContent<{ pulp_href: string }>>)
    .create === 'function';

// The dialog that puts files into a repository. The user chooses files, gives
// each its path where the plugin asks for one, is told how many repository
// versions the upload will make, and then watches every file go: its progress
// while it is sent and, when the server has finished with it, whether it was
// added or why not. An administrator's files make one version together; for
// everyone else each file makes a version of its own. Closing the dialog while
// files are on their way asks whether to cancel, and canceling stops what is
// being sent.
export const UploadDialog = ({
  repository,
  entity,
  types,
  upload,
  onClose,
}: Props) => {
  const { hasPermission, isStaff } = useAppContext();
  const queryClient = useQueryClient();
  const { watch } = useWatchTask();
  const labelId = useId();
  const nextId = useRef(0);
  const started = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const repositoryName = repository.name;
  const content = types.find(({ id }) => id === upload.contentType)?.entity;
  if (!content || !isUploadable(content)) {
    throw new Error(
      'The upload names a content type that cannot be made from files',
    );
  }

  const contentEntity = content;

  // An administrator may make content without a repository, which is what lets
  // several files become one version; the upload endpoints need a permission of
  // their own, and a user without it sends each file in one request.
  const superuser = isStaff;
  const mayChunk = hasPermission('core.add_upload');
  const retained = repository.retain_repo_versions;

  const [entries, setEntries] = useState<Entry[]>([]);
  const [phase, setPhase] = useState<'choose' | 'running' | 'done'>('choose');
  const [results, setResults] = useState<ReadonlyMap<number, Progressed>>(
    () => new Map(),
  );
  const [adding, setAdding] = useState<Adding>({});
  const [asking, setAsking] = useState(false);

  const choose = (files: File[]) =>
    setEntries((current) => [
      ...current,
      ...files.map((file) => {
        nextId.current += 1;
        return { id: nextId.current, file, path: file.name };
      }),
    ]);
  const setPath = (id: number, path: string) =>
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, path } : entry)),
    );
  const remove = (id: number) =>
    setEntries((current) => current.filter((entry) => entry.id !== id));

  const asksForPath = upload.relativePath === 'required-default-name';
  const problems = new Map<number, string>();
  if (asksForPath) {
    for (const { id, path } of entries) {
      const problem = pathProblem(path);
      if (problem) {
        problems.set(id, problem);
      }
    }
  }
  const canStart = entries.length > 0 && problems.size === 0;

  async function start() {
    if (started.current || !canStart) {
      return;
    }
    started.current = true;
    const run = new AbortController();
    controller.current = run;
    const { signal } = run;
    setPhase('running');

    const known = new Map<number, Progressed>();
    const patch = (id: number, change: Progressed) => {
      known.set(id, { ...known.get(id), ...change });
      if (mounted.current) {
        setResults(new Map(known));
      }
    };
    const pending: { href: string; label: string }[] = [];
    const waits: Promise<void>[] = [];
    const turn = limiter(TASKS_AT_ONCE);
    const idOf = (index: number) => entries[index]?.id ?? -1;

    const follow = (id: number, task: string, name: string) =>
      turn(async () => {
        const end = await readTaskToEnd(task, { signal });
        patch(id, { end });
        if (end.state === 'pending') {
          pending.push({
            href: task,
            label: t`Upload of ${name} to ${repositoryName}`,
          });
        }
      });

    const finished = await uploadFiles({
      items: entries.map(({ file, path }) => ({
        file,
        ...(upload.relativePath === 'required-default-name'
          ? { relativePath: path }
          : {}),
      })),
      contentEntity,
      repository: repository.pulp_href,
      repositoryEntity: entity,
      superuser,
      mayChunk,
      waitForTask: readTaskToEnd,
      signal,
      onProgress: (index, progress) => patch(idOf(index), { progress }),
      onSettled: (index, outcome) => {
        const id = idOf(index);
        patch(id, { outcome });
        if (outcome.kind === 'started') {
          waits.push(follow(id, outcome.task, entries[index]?.file.name ?? ''));
        }
      },
    });

    await Promise.all(waits);

    let addEnd: TaskEnd | undefined;
    if (finished.add) {
      if (mounted.current) {
        setAdding({ outcome: finished.add });
      }
      if (finished.add.kind === 'started') {
        addEnd = await readTaskToEnd(finished.add.task, { signal });
        if (mounted.current) {
          setAdding({ outcome: finished.add, end: addEnd });
        }
        if (addEnd.state === 'pending') {
          pending.push({
            href: finished.add.task,
            label: t`Addition of uploaded files to ${repositoryName}`,
          });
        }
      }
    }

    // Tasks the dialog stopped waiting for keep running on the server; the
    // application follows them to their end.
    for (const { href, label } of pending) {
      watch({
        href,
        label,
        resource: {
          app: entity.app,
          object: entity.object,
          href: repository.pulp_href,
        },
      });
    }
    // The Content tab and the versions read the repository again, so the new
    // version shows.
    void queryClient.invalidateQueries({ queryKey: entityKeys(entity).all });
    void queryClient.invalidateQueries({ queryKey: taskKeys.index });
    if (mounted.current) {
      setPhase('done');
    }
  }

  const requestClose = () => {
    if (phase === 'running') {
      setAsking(true);
    } else {
      onClose();
    }
  };

  const running = phase === 'running';
  const finishedRun = phase === 'done';
  const statuses = new Map(
    entries.map(({ id }) => [
      id,
      statusOf(results.get(id), adding, finishedRun),
    ]),
  );
  const counts = {
    added: 0,
    failed: 0,
  };
  const shown = Array.from(statuses.values());
  for (const status of shown) {
    if (status.kind === 'added') {
      counts.added += 1;
    } else if (status.kind === 'failed') {
      counts.failed += 1;
    }
  }
  const notAdded =
    finishedRun && shown.some(({ kind }) => kind === 'not-added');
  const total = entries.length;
  const added = counts.added;

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={requestClose}
      variant='large'
    >
      <ModalHeader labelId={labelId} title={t`Upload files`} />
      <ModalBody>
        {phase === 'choose' ? (
          <MultipleFileUpload
            onFileDrop={(_event, files) => choose(files)}
            dropzoneProps={{ multiple: true }}
          >
            <MultipleFileUploadMain
              titleIcon={<UploadIcon />}
              titleText={t`Drag and drop files here`}
              titleTextSeparator={t`or`}
              browseButtonText={t`Choose files`}
            />
          </MultipleFileUpload>
        ) : null}
        {finishedRun ? (
          notAdded ? (
            <Alert
              isInline
              variant='danger'
              title={t`Nothing was added to the repository`}
            >
              {t`Not every file could be made, so none was added. The files that were made stay as content that belongs to no repository.`}
            </Alert>
          ) : (
            <Alert
              isInline
              variant={added === total ? 'success' : 'warning'}
              title={
                added === total
                  ? plural(total, {
                      one: '# file added',
                      other: '# files added',
                    })
                  : t`${added} of ${total} files added`
              }
            />
          )
        ) : null}
        {entries.length > 0 ? (
          <Table aria-label={t`Files to upload`}>
            <Thead>
              <Tr>
                <Th>{t`File`}</Th>
                <Th>{t`Size`}</Th>
                {upload.relativePath === 'none' ? null : (
                  <Th>{t`Relative path`}</Th>
                )}
                <Th>{phase === 'choose' ? '' : t`Result`}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {entries.map(({ id, file, path }) => {
                const problem = problems.get(id);
                const status = statuses.get(id) ?? { kind: 'uploading' };
                const name = file.name;

                return (
                  <Tr key={id}>
                    <Td dataLabel={t`File`} className='pulp-break-anywhere'>
                      {name}
                    </Td>
                    <Td dataLabel={t`Size`}>{getHumanSize(file.size)}</Td>
                    {upload.relativePath === 'none' ? null : (
                      <Td
                        dataLabel={t`Relative path`}
                        className='pulp-break-anywhere'
                      >
                        {phase === 'choose' && asksForPath ? (
                          <>
                            <TextInput
                              aria-label={t`Relative path of ${name}`}
                              value={path}
                              validated={problem ? 'error' : 'default'}
                              onChange={(_event, value) => setPath(id, value)}
                            />
                            {problem ? (
                              <FormHelperText>
                                <HelperText>
                                  <HelperTextItem variant='error'>
                                    {problem}
                                  </HelperTextItem>
                                </HelperText>
                              </FormHelperText>
                            ) : null}
                          </>
                        ) : asksForPath ? (
                          path
                        ) : (
                          name
                        )}
                      </Td>
                    )}
                    <Td dataLabel={t`Result`} className='pulp-break-anywhere'>
                      {phase === 'choose' ? (
                        <Button
                          variant='plain'
                          aria-label={t`Remove ${name}`}
                          onClick={() => remove(id)}
                        >
                          {t`Remove`}
                        </Button>
                      ) : (
                        <Result
                          status={status}
                          name={name}
                          progress={results.get(id)?.progress}
                          chunked={isChunked(file.size, mayChunk)}
                        />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        ) : null}
        {phase === 'choose' ? (
          <>
            {superuser ? (
              <Alert
                isInline
                variant='info'
                title={t`All files are added in one new repository version`}
              />
            ) : (
              <Alert
                isInline
                variant='info'
                title={t`Each file creates its own repository version`}
              >
                {t`Adding several files as one version needs an administrator.`}
              </Alert>
            )}
            {!superuser && typeof retained === 'number' && retained >= 1 ? (
              <Alert
                isInline
                variant='warning'
                title={t`Older versions may be removed`}
              >
                {plural(retained, {
                  one: 'This repository keeps only its latest version, so every uploaded file pushes the version before it out.',
                  other:
                    'This repository keeps only its latest # versions, so every uploaded file pushes the oldest version out.',
                })}
              </Alert>
            ) : null}
          </>
        ) : null}
        {asking ? (
          <Alert
            isInline
            variant='warning'
            title={t`Cancel the upload?`}
            actionLinks={
              <>
                <AlertActionLink
                  onClick={() => {
                    setAsking(false);
                    controller.current?.abort();
                  }}
                >
                  {t`Stop uploading`}
                </AlertActionLink>
                <AlertActionLink onClick={() => setAsking(false)}>
                  {t`Keep uploading`}
                </AlertActionLink>
              </>
            }
          >
            {t`Files that have not been sent will not be uploaded. Files that were already added stay in the repository.`}
          </Alert>
        ) : null}
      </ModalBody>
      <ModalFooter>
        {phase === 'choose' ? (
          <>
            <Button
              key='upload'
              variant='primary'
              isDisabled={!canStart}
              onClick={() => void start()}
            >
              {t`Upload`}
            </Button>
            <Button key='cancel' variant='link' onClick={onClose}>
              {t`Cancel`}
            </Button>
          </>
        ) : null}
        {running ? (
          <Button key='stop' variant='link' onClick={() => setAsking(true)}>
            {t`Cancel upload`}
          </Button>
        ) : null}
        {finishedRun ? (
          <Button key='done' variant='primary' onClick={onClose}>
            {t`Done`}
          </Button>
        ) : null}
      </ModalFooter>
    </Modal>
  );
};

interface ResultProps {
  status: Status;
  name: string;
  progress: UploadProgress | undefined;
  chunked: boolean;
}

// What one file's row says about it: a bar while its chunks go, a short line
// while the server works, and the outcome with its reason at the end.
function Result({ status, name, progress, chunked }: ResultProps) {
  switch (status.kind) {
    case 'uploading':
      return chunked ? (
        <Progress
          aria-label={t`Upload of ${name}`}
          value={
            progress && progress.total > 0
              ? Math.round((progress.sent / progress.total) * 100)
              : 0
          }
          size='sm'
        />
      ) : (
        <>
          <Spinner size='sm' /> {t`Uploading`}
        </>
      );
    case 'waiting-task':
      return (
        <>
          <Spinner size='sm' /> {t`Waiting for the server`}
        </>
      );
    case 'waiting-others':
      return (
        <>
          <Spinner size='sm' /> {t`Waiting for the other files`}
        </>
      );
    case 'adding':
      return (
        <>
          <Spinner size='sm' /> {t`Adding to the repository`}
        </>
      );
    case 'added':
      return <Label color='green'>{t`Added`}</Label>;
    case 'not-added':
      return <Label color='grey'>{t`Not added`}</Label>;
    case 'canceled':
      return <Label color='grey'>{t`Canceled`}</Label>;
    case 'not-sent':
      return <Label color='grey'>{t`Not sent`}</Label>;
    case 'failed':
      return (
        <>
          <Label color='red'>{t`Failed`}</Label>
          <div>{status.reason}</div>
        </>
      );
    default:
      return (
        <>
          <Label color='orange'>{t`Not confirmed`}</Label>
          <div>{status.reason}</div>
        </>
      );
  }
}
