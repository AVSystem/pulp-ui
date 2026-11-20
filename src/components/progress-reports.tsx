import { t } from '@lingui/core/macro';
import {
  Flex,
  FlexItem,
  Label,
  type LabelProps,
  Progress,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { Fragment } from 'react';

// What a progress report of a task says, as far as a screen reads it: the stage
// it is about, how far the stage has come, and its state. The server may leave
// any of them out, and a report may carry fields nothing here reads.
type ProgressReport = Record<string, unknown>;

interface Props {
  reports: readonly ProgressReport[];
  // The reports are listed in the order the task made them; a screen that
  // wants the latest stage first asks for it.
  newestFirst?: boolean;
  // Draws a rule above every report, for a screen that lists them under a
  // heading of its own.
  divided?: boolean;
}

// The states a report or a task can be in, with the text and colour that name
// them. A state this list does not know is shown as the server wrote it.
function stateLabel(state: string): {
  text: string;
  color: LabelProps['color'];
} {
  switch (state) {
    case 'waiting':
      return { text: t`Pending`, color: 'blue' };
    case 'running':
      return { text: t`Running`, color: 'blue' };
    case 'completed':
      return { text: t`Completed`, color: 'green' };
    case 'failed':
      return { text: t`Failed`, color: 'red' };
    case 'canceled':
      return { text: t`Canceled`, color: 'orange' };
    case 'canceling':
      return { text: t`Canceling`, color: 'orange' };
    case 'skipped':
      return { text: t`Skipped`, color: 'grey' };
    default:
      return { text: state, color: 'grey' };
  }
}

// The state of a task or of one stage of it, as a compact label.
export const TaskStateLabel = ({ state }: { state: string }) => {
  const { text, color } = stateLabel(state);

  return (
    <Label isCompact color={color}>
      {text}
    </Label>
  );
};

const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// The stage message of a report. A report with no message is named by its
// code, which is the server's own name for the stage.
function messageOf(report: ProgressReport): string {
  const { message, code } = report;
  if (typeof message === 'string' && message) {
    return message;
  }
  return typeof code === 'string' ? code : '';
}

const ProgressReportRow = ({ report }: { report: ProgressReport }) => {
  const message = messageOf(report);
  const done = whole(report['done']);
  const total = whole(report['total']);
  const figure = done ?? 0;
  const state = typeof report['state'] === 'string' ? report['state'] : null;

  return (
    <div data-cy='ProgressReport'>
      <Flex
        justifyContent={{ default: 'justifyContentSpaceBetween' }}
        alignItems={{ default: 'alignItemsFlexStart' }}
        spaceItems={{ default: 'spaceItemsMd' }}
        flexWrap={{ default: 'nowrap' }}
      >
        <FlexItem>{message}</FlexItem>
        {state ? (
          <FlexItem>
            <TaskStateLabel state={state} />
          </FlexItem>
        ) : null}
      </Flex>
      {total !== null && total > 0 ? (
        <Progress
          aria-label={message}
          size='sm'
          min={0}
          max={total}
          value={Math.min(figure, total)}
          measureLocation='outside'
          label={`${figure}/${total}`}
          valueText={t`${figure} of ${total}`}
          variant={
            state === 'completed'
              ? 'success'
              : state === 'failed'
                ? 'danger'
                : undefined
          }
        />
      ) : done !== null ? (
        <div>{t`${done} done`}</div>
      ) : null}
    </div>
  );
};

// The progress reports of a task: each stage with its message and state, a bar
// with done and total where the stage knows its total, and the count alone
// where it does not. Nothing is drawn for a stage the server has not reported
// on, and a report is never read for anything but text and numbers.
export const ProgressReports = ({
  reports,
  newestFirst = false,
  divided = false,
}: Props) => {
  const ordered = newestFirst ? [...reports].reverse() : reports;

  if (divided) {
    return (
      <>
        {ordered.map((report, index) => (
          <Fragment key={index}>
            <hr />
            <ProgressReportRow report={report} />
          </Fragment>
        ))}
      </>
    );
  }

  return (
    <Stack hasGutter>
      {ordered.map((report, index) => (
        <StackItem key={index}>
          <ProgressReportRow report={report} />
        </StackItem>
      ))}
    </Stack>
  );
};
