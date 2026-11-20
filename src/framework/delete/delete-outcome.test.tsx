import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { OutcomeReport, keptTitle, outcomeAlert } from './delete-outcome';
import type { DeleteRepositoryResult } from './delete-repository';

const API = '/pulp/api/v3';

const result = (
  overrides: Partial<DeleteRepositoryResult> = {},
): DeleteRepositoryResult => ({
  removed: [],
  failed: [],
  pending: [],
  unknown: [],
  unlisted: [],
  unconfirmed: [],
  notSent: [],
  repositoryDeleted: false,
  repositoryError: null,
  repositoryPending: null,
  repositoryUnknown: null,
  repositoryUnconfirmed: false,
  ...overrides,
});

describe(
  'Unit: the title of a delete that kept the repository',
  { tags: ['unit'] },
  () => {
    it('says some distributions were not removed when one failed, one is still going, one is unknown or one was not shown', () => {
      const want =
        'The repository was kept because not every distribution was removed.';

      expect(keptTitle(result({ failed: [{ name: 'a', reason: 'no' }] }))).toBe(
        want,
      );
      expect(
        keptTitle(
          result({ pending: [{ name: 'a', taskHref: `${API}/tasks/1/` }] }),
        ),
      ).toBe(want);
      expect(
        keptTitle(
          result({ unknown: [{ name: 'a', taskHref: `${API}/tasks/1/` }] }),
        ),
      ).toBe(want);
      expect(keptTitle(result({ unlisted: ['late'] }))).toBe(want);
    });

    it('keeps the distribution title when a distribution failed and the repository task is still running', () => {
      expect(
        keptTitle(
          result({
            failed: [{ name: 'a', reason: 'no' }],
            repositoryPending: `${API}/tasks/1/`,
          }),
        ),
      ).toBe(
        'The repository was kept because not every distribution was removed.',
      );
    });

    it('says the removal is not confirmed, not that the repository was not removed, while its task runs or cannot be read', () => {
      const want = 'The removal of the repository has not been confirmed.';

      expect(keptTitle(result({ repositoryPending: `${API}/tasks/1/` }))).toBe(
        want,
      );
      expect(keptTitle(result({ repositoryUnknown: `${API}/tasks/1/` }))).toBe(
        want,
      );
    });

    it('says the session ended when it left the delete unfinished', () => {
      const want = 'The session ended before the delete was finished.';

      expect(keptTitle(result({ unconfirmed: ['a'] }))).toBe(want);
      expect(keptTitle(result({ notSent: ['a'] }))).toBe(want);
      expect(keptTitle(result({ repositoryUnconfirmed: true }))).toBe(want);
    });

    it('says the distributions were removed but the repository kept when only the repository failed', () => {
      expect(
        keptTitle(
          result({ removed: ['a'], repositoryError: 'Not allowed here.' }),
        ),
      ).toBe('The distributions were removed but the repository was kept.');
    });

    it('says only that the repository was not removed when no distribution was involved', () => {
      expect(keptTitle(result({ repositoryError: 'Not allowed here.' }))).toBe(
        'The repository was not removed.',
      );
    });
  },
);

describe(
  'Integration: the report of a delete that kept the repository',
  { tags: ['integration'] },
  () => {
    it('says what was removed, what failed with the reason, what is still being removed and what is unknown, with the links to the tasks', () => {
      renderWithProviders(
        <OutcomeReport
          result={result({
            removed: ['removed-one'],
            failed: [
              {
                name: 'refused-one',
                reason: 'You do not have permission to perform this action.',
              },
            ],
            pending: [
              {
                name: 'slow-one',
                taskHref: `${API}/tasks/00000000-0000-4000-8000-0000000000aa/`,
              },
            ],
            unknown: [
              {
                name: 'unreadable-one',
                taskHref: `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`,
              },
            ],
            unlisted: ['b-created-later'],
          })}
        />,
      );

      expect(screen.getByText('Removed')).toBeVisible();
      expect(screen.getByText('removed-one')).toBeVisible();
      expect(
        screen.getByText(
          'refused-one: You do not have permission to perform this action.',
        ),
      ).toBeVisible();
      expect(screen.getByText('Still being removed')).toBeVisible();
      expect(screen.getByText('Outcome unknown, check the task')).toBeVisible();
      expect(
        screen.getByText('Not removed, not shown when this dialog opened'),
      ).toBeVisible();
      expect(screen.getByText('b-created-later')).toBeVisible();
      const links = screen.getAllByRole('link', { name: 'task' });
      expect(links.map((link) => link.getAttribute('href'))).toStrictEqual([
        '/tasks/00000000-0000-4000-8000-0000000000aa/',
        '/tasks/00000000-0000-4000-8000-0000000000cc/',
      ]);
    });

    it('says why the repository itself was not removed, and where its task is', () => {
      renderWithProviders(
        <OutcomeReport
          result={result({
            repositoryError: 'Not allowed here.',
            repositoryPending: `${API}/tasks/00000000-0000-4000-8000-0000000000dd/`,
          })}
        />,
      );

      expect(
        screen.getByText(
          'The repository could not be removed: Not allowed here.',
        ),
      ).toBeVisible();
      expect(
        screen.getByText(/The repository is still being removed:/),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'task' })).toHaveAttribute(
        'href',
        '/tasks/00000000-0000-4000-8000-0000000000dd/',
      );
    });

    it('says it is not known whether the repository was removed when the session ended during its delete', () => {
      renderWithProviders(
        <OutcomeReport result={result({ repositoryUnconfirmed: true })} />,
      );

      expect(
        screen.getByText('It is not known whether the repository was removed.'),
      ).toBeVisible();
    });

    it('lists what the session end left unconfirmed and what was never sent', () => {
      renderWithProviders(
        <OutcomeReport
          result={result({ unconfirmed: ['in-flight'], notSent: ['waiting'] })}
        />,
      );

      expect(screen.getByText('Not confirmed')).toBeVisible();
      expect(screen.getByText('in-flight')).toBeVisible();
      expect(screen.getByText('Not sent')).toBeVisible();
      expect(screen.getByText('waiting')).toBeVisible();
    });
  },
);

describe(
  'Integration: the alert a delete leaves for the next screen',
  { tags: ['integration'] },
  () => {
    it('is a success naming the repository and the distributions removed with it', () => {
      expect(
        outcomeAlert(
          'tools',
          result({ removed: ['a', 'b'], repositoryDeleted: true }),
        ),
      ).toStrictEqual({
        variant: 'success',
        title: 'Removed repository tools',
        description: 'Removed distributions: a, b',
      });
    });

    it('is a success with no description when no distribution went with the repository', () => {
      expect(
        outcomeAlert('tools', result({ repositoryDeleted: true })),
      ).toStrictEqual({
        variant: 'success',
        title: 'Removed repository tools',
        description: undefined,
      });
    });

    it('is a danger naming the repository and what became of each distribution when the repository was kept', () => {
      const alert = outcomeAlert(
        'tools',
        result({
          removed: ['a'],
          failed: [{ name: 'b', reason: 'Not for you.' }],
        }),
      );

      expect(alert.variant).toBe('danger');
      expect(alert.title).toBe(
        'The repository was kept because not every distribution was removed.',
      );
      render(<>{alert.description}</>);
      expect(screen.getByText('Repository: tools')).toBeVisible();
      expect(screen.getByText('b: Not for you.')).toBeVisible();
      expect(screen.getByText('a')).toBeVisible();
    });

    it('is a warning when the outcome is not known: the repository task runs, cannot be read or the session ended', () => {
      expect(
        outcomeAlert('tools', result({ repositoryPending: `${API}/tasks/1/` }))
          .variant,
      ).toBe('warning');
      expect(
        outcomeAlert('tools', result({ repositoryUnknown: `${API}/tasks/1/` }))
          .variant,
      ).toBe('warning');
      expect(
        outcomeAlert('tools', result({ unconfirmed: ['a'] })).variant,
      ).toBe('warning');
    });
  },
);
