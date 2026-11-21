import { t } from '@lingui/core/macro';
import {
  Button,
  Content,
  Label,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import {
  type ReactNode,
  memo,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import { useAppContext } from 'src/app-context';
import { Alert, type AlertType, Spinner, Table } from 'src/components';
import { taskUrlId } from 'src/entities/core/task/href';
import { Paths, formatPath } from 'src/paths';
import { requestErrorDescription } from 'src/utilities/request-error';
import {
  type BulkOutcome,
  type BulkResult,
  type BulkSummary,
  type BulkTarget,
  type OnSettled,
  summarize,
} from './bulk-actions';

// The dialog of a bulk action. It asks once, naming every row the action will
// be sent for and, apart, those the user may not act on, which are not sent.
// Nothing is requested before the user confirms. After the confirmation it
// stays on screen and cannot be closed until the work has ended, showing each
// row as pending until its own result arrives and keeping the table of results
// until the user closes it. When the work ends a summary is handed to the
// screen the dialog belongs to, or, when the user has left it meanwhile, queued
// for the screen they are on.

// A row of the confirmation. The note says what else the action does to it.
export interface BulkRow extends BulkTarget {
  note?: string;
}

interface Props {
  title: string;
  // What the action does, in one sentence above the names.
  lead: ReactNode;
  confirmLabel: string;
  // The action destroys data: the confirm button is drawn as a danger action.
  isDanger?: boolean;
  // The rows the action is sent for.
  rows: readonly BulkRow[];
  // The names of the rows the user may not act on. They are listed and never
  // sent.
  notPermitted: readonly string[];
  // The inputs of the action itself (the options of a sync, the key and value
  // of a label), drawn above the names.
  options?: ReactNode;
  // False while the inputs are not complete; the action is not offered.
  canStart?: boolean;
  // Does the work, calling `onSettled` as each row ends. It resolves with one
  // result per row and does not reject for one row's failure.
  run: (onSettled: OnSettled) => Promise<BulkResult[]>;
  // The title of the summary alert, from the counts.
  alertTitle: (summary: BulkSummary) => string;
  onClose: () => void;
  // Called once the work has ended, with the summary, while the screen the
  // dialog belongs to is still shown.
  onFinished: (alert: AlertType) => void;
  // Reads again what the work changed. It runs when the user closes the dialog
  // after the work, not before: the list behind may lose its rows or change
  // into an empty state, and the table of results must stay until it is closed.
  // When the user has left the screen it runs as soon as the work ends.
  afterRun?: () => void;
}

// The line that says what a run came to: only the counts that are not zero.
export function summaryLine(summary: BulkSummary): string {
  const parts: string[] = [];
  if (summary.succeeded) {
    const count = summary.succeeded;
    parts.push(t`${count} succeeded`);
  }
  if (summary.started) {
    const count = summary.started;
    parts.push(t`${count} started`);
  }
  if (summary.skipped) {
    const count = summary.skipped;
    parts.push(t`${count} skipped`);
  }
  if (summary.failed) {
    const count = summary.failed;
    parts.push(t`${count} failed`);
  }
  if (summary.stopped) {
    const count = summary.stopped;
    parts.push(t`${count} not carried out because the session ended`);
  }

  return parts.join(', ');
}

const taskLink = (task: string) => {
  const id = taskUrlId(task);

  return id ? (
    <Link to={formatPath(Paths.core.task.detail, { task: id })}>
      {t`View the task`}
    </Link>
  ) : null;
};

// The result of one row in words: a label, and the reason or the link.
function Result({ outcome }: { outcome: BulkOutcome | undefined }) {
  switch (outcome?.kind) {
    case undefined:
      return <Label variant='outline'>{t`Pending`}</Label>;
    case 'succeeded':
      return <Label color='green'>{t`Succeeded`}</Label>;
    case 'started':
      return <Label color='blue'>{t`Started`}</Label>;
    case 'skipped':
      return <Label color='grey'>{t`Skipped`}</Label>;
    case 'failed':
      return <Label color='red'>{t`Failed`}</Label>;
    case 'not-sent':
      return <Label color='orange'>{t`Not sent`}</Label>;
    default:
      return <Label color='orange'>{t`Not confirmed`}</Label>;
  }
}

function Details({ outcome }: { outcome: BulkOutcome | undefined }) {
  switch (outcome?.kind) {
    case 'succeeded':
      return <>{outcome.note ?? null}</>;
    case 'started':
      return (
        <>
          {outcome.note ? <>{outcome.note} </> : null}
          {taskLink(outcome.task)}
        </>
      );
    case 'skipped':
    case 'failed':
      return <>{outcome.reason}</>;
    case 'not-sent':
      return <>{t`The session ended before this one was sent.`}</>;
    case 'unconfirmed':
      return <>{t`The session ended while this one was on its way.`}</>;
    default:
      return null;
  }
}

// One row of the table of results. It is rebuilt only when its own result
// arrives, so five hundred rows do not redraw for every one that ends.
const ResultRow = memo(function ResultRow({
  name,
  outcome,
}: {
  name: string;
  outcome: BulkOutcome | undefined;
}) {
  return (
    <Tr>
      <Td dataLabel={t`Name`}>{name}</Td>
      <Td dataLabel={t`Result`}>
        <Result outcome={outcome} />
      </Td>
      <Td dataLabel={t`Details`} className='pulp-break-anywhere'>
        <Details outcome={outcome} />
      </Td>
    </Tr>
  );
});

const NAMES_STYLE = {
  maxHeight: '40vh',
  overflowY: 'auto',
  marginBottom: 'var(--pf-t--global--spacer--md)',
} as const;

export const BulkDialog = ({
  title,
  lead,
  confirmLabel,
  isDanger,
  rows,
  notPermitted,
  options,
  canStart = true,
  run,
  alertTitle,
  onClose,
  onFinished,
  afterRun,
}: Props) => {
  const labelId = useId();
  const { queueAlert } = useAppContext();
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm');
  const [settled, setSettled] = useState<ReadonlyMap<string, BulkOutcome>>(
    () => new Map(),
  );
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [failure, setFailure] = useState<ReactNode>(null);
  // Set synchronously, so a second press before the screen has drawn the first
  // still sends one run.
  const started = useRef(false);
  // Whether the work has sent anything: what the screen behind shows is stale
  // from then on.
  const ran = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const confirm = async () => {
    if (started.current || !canStart || rows.length === 0) {
      return;
    }
    started.current = true;
    ran.current = true;
    setPhase('running');

    // The outcomes of the rows that ended, kept outside the state so a burst of
    // them is one redraw per frame of work and never loses one.
    const ended = new Map<string, BulkOutcome>();
    try {
      const results = await run(({ target, outcome }) => {
        ended.set(target.pulp_href, outcome);
        if (mounted.current) {
          setSettled(new Map(ended));
        }
      });
      const counts = summarize(results);
      const alert: AlertType = {
        variant:
          counts.failed || counts.stopped
            ? 'warning'
            : counts.succeeded || counts.started
              ? 'success'
              : 'info',
        title: alertTitle(counts),
        description: summaryLine(counts),
        live: true,
      };
      if (mounted.current) {
        setSettled(
          new Map(
            results.map(({ target, outcome }) => [target.pulp_href, outcome]),
          ),
        );
        setSummary(counts);
        setPhase('done');
        onFinished(alert);
      } else {
        queueAlert(alert);
        afterRun?.();
      }
    } catch (error) {
      const alert: AlertType = {
        variant: 'danger',
        title: t`The bulk action stopped with an unexpected error. Some rows may already have been changed: check the list before trying again.`,
        description: requestErrorDescription(error),
      };
      if (mounted.current) {
        setFailure(alert.description);
        setPhase('done');
      } else {
        queueAlert(alert);
        afterRun?.();
      }
    }
  };

  const close = () => {
    if (ran.current) {
      afterRun?.();
    }
    onClose();
  };

  const running = phase === 'running';

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={running ? undefined : close}
      variant='large'
      data-cy='BulkDialog'
    >
      <ModalHeader
        labelId={labelId}
        title={title}
        titleIconVariant={
          isDanger && phase === 'confirm' ? 'warning' : undefined
        }
      />
      <ModalBody>
        {phase === 'confirm' ? (
          <>
            <Content component='p'>{lead}</Content>
            {options}
            {rows.length > 0 ? (
              <>
                <Content component='p'>
                  <strong>{t`Selected`}</strong>
                </Content>
                <div
                  style={NAMES_STYLE}
                  tabIndex={0}
                  role='region'
                  aria-label={t`Selected names`}
                >
                  <List isPlain>
                    {rows.map(({ pulp_href, name, note }) => (
                      <ListItem key={pulp_href}>
                        <strong>{name}</strong>
                        {note ? <> - {note}</> : null}
                      </ListItem>
                    ))}
                  </List>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {notPermitted.length > 0 ? (
          <>
            <Content component='p'>
              <strong>{t`Not permitted`}</strong>
            </Content>
            <Content component='p'>
              {t`You may not do this on the following, so nothing is sent for them:`}
            </Content>
            <div
              style={NAMES_STYLE}
              tabIndex={0}
              role='region'
              aria-label={t`Names not permitted`}
            >
              <List isPlain>
                {notPermitted.map((name) => (
                  <ListItem key={name}>{name}</ListItem>
                ))}
              </List>
            </div>
          </>
        ) : null}

        {phase !== 'confirm' ? (
          <>
            {summary ? (
              <Alert
                isInline
                variant={
                  summary.failed || summary.stopped ? 'warning' : 'success'
                }
                title={summaryLine(summary)}
              />
            ) : null}
            {failure !== null ? (
              <Alert
                isInline
                variant='danger'
                title={t`The bulk action stopped with an unexpected error. Some rows may already have been changed: check the list before trying again.`}
              >
                {failure}
              </Alert>
            ) : null}
            <div
              style={{ maxHeight: '50vh', overflowY: 'auto' }}
              tabIndex={0}
              role='region'
              aria-label={t`Results`}
            >
              <Table aria-label={t`Results`} variant='compact' isStickyHeader>
                <Thead>
                  <Tr>
                    <Th>{t`Name`}</Th>
                    <Th>{t`Result`}</Th>
                    <Th>{t`Details`}</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map(({ pulp_href, name }) => (
                    <ResultRow
                      key={pulp_href}
                      name={name}
                      outcome={settled.get(pulp_href)}
                    />
                  ))}
                </Tbody>
              </Table>
            </div>
          </>
        ) : null}
      </ModalBody>
      <ModalFooter>
        {phase === 'confirm' ? (
          <>
            <Button
              variant={isDanger ? 'danger' : 'primary'}
              onClick={confirm}
              isDisabled={!canStart || rows.length === 0}
            >
              {confirmLabel}
            </Button>
            <Button variant='link' onClick={close}>
              {t`Cancel`}
            </Button>
          </>
        ) : (
          <Button variant='primary' onClick={close} isDisabled={running}>
            {t`Close`}
            {running ? <Spinner size='sm' /> : null}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};
