import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressReports } from './progress-reports';

const reports = [
  {
    message: 'Downloading artifacts',
    code: 'sync.downloading.artifacts',
    state: 'running',
    done: 120,
    total: 300,
  },
  {
    message: 'Parsing metadata',
    code: 'sync.parsing.metadata',
    state: 'completed',
    done: 4,
  },
];

describe('Integration: progress reports', { tags: ['integration'] }, () => {
  it('shows done of total with a bar where the total is known and the count alone where it is not', () => {
    render(<ProgressReports reports={reports} />);

    expect(screen.getByText('Downloading artifacts')).toBeVisible();
    expect(screen.getByText('120/300')).toBeVisible();
    const bar = screen.getByRole('progressbar', {
      name: 'Downloading artifacts',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '120');
    expect(bar).toHaveAttribute('aria-valuemax', '300');
    expect(screen.getByText('Parsing metadata')).toBeVisible();
    expect(screen.getByText('4 done')).toBeVisible();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('names the state of each stage', () => {
    render(<ProgressReports reports={reports} />);

    expect(screen.getByText('Running')).toBeVisible();
    expect(screen.getByText('Completed')).toBeVisible();
  });

  it('lists the stages in the order of the task, or the latest first when asked', () => {
    const order = () =>
      screen
        .getAllByText(/^(Downloading artifacts|Parsing metadata)$/)
        .map((element) => element.textContent);

    const { unmount } = render(<ProgressReports reports={reports} />);
    expect(order()).toEqual(['Downloading artifacts', 'Parsing metadata']);
    unmount();

    render(<ProgressReports reports={reports} newestFirst />);
    expect(order()).toEqual(['Parsing metadata', 'Downloading artifacts']);
  });

  it('names a stage that has no message by its code, and draws no figure for one that has none', () => {
    render(<ProgressReports reports={[{ code: 'sync.unknown.stage' }]} />);

    expect(screen.getByText('sync.unknown.stage')).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/done/)).toBeNull();
  });

  it('keeps a bar inside its range when a stage reports more than its total', () => {
    render(
      <ProgressReports
        reports={[{ message: 'Over', state: 'running', done: 12, total: 10 }]}
      />,
    );

    expect(screen.getByRole('progressbar', { name: 'Over' })).toHaveAttribute(
      'aria-valuenow',
      '10',
    );
  });

  it('draws a rule above every stage when asked', () => {
    const { container } = render(<ProgressReports reports={reports} divided />);

    expect(container.querySelectorAll('hr')).toHaveLength(2);
  });

  it('shows text only: markup in a message is not interpreted', () => {
    const { container } = render(
      <ProgressReports
        reports={[{ message: '<img src=x onerror=alert(1)>' }]}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  });

  it('draws nothing for no reports', () => {
    const { container } = render(<ProgressReports reports={[]} />);

    expect(
      container.querySelectorAll('[data-cy="ProgressReport"]'),
    ).toHaveLength(0);
  });
});
