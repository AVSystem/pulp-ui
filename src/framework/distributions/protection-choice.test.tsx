import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { contentGuard, contentGuardListHandler } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { GuardField } from './guard-field';
import { type Protection, ProtectionChoice } from './protection-choice';

const GUARDS = '/pulp/api/v3/contentguards/';

const at = (kind: string, id: number) =>
  `${GUARDS}${kind}/00000000-0000-4000-8000-${String(id).padStart(12, '0')}/`;

const customers = contentGuard({
  name: 'customers',
  pulp_href: at('core/rbac', 1),
});
const partners = contentGuard({
  name: 'partners',
  pulp_href: at('certguard/x509', 2),
});

// Holds the value the way a form does and records every value reported.
function Harness({
  reported,
  initial = null,
}: {
  reported: Protection[];
  initial?: Protection;
}) {
  const [value, setValue] = useState<Protection>(initial);

  return (
    <ProtectionChoice
      value={value}
      onChange={(next) => {
        reported.push(next);
        setValue(next);
      }}
    />
  );
}

const protectedRadio = () =>
  screen.getByRole('radio', { name: /Protected by a content guard/ });
const publicRadio = () => screen.getByRole('radio', { name: /^Public/ });
const picker = () =>
  screen.findByRole('combobox', { name: 'Select a content guard' });

describe(
  'Integration: the protection choice',
  { tags: ['integration'] },
  () => {
    it('starts with neither radio chosen, offers no guard picker and reports nothing', () => {
      const reported: Protection[] = [];

      renderWithProviders(<Harness reported={reported} />);

      expect(protectedRadio()).not.toBeChecked();
      expect(publicRadio()).not.toBeChecked();
      expect(publicRadio()).toHaveAccessibleName(
        'Public - anyone can download without signing in',
      );
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(reported).toStrictEqual([]);
    });

    it('stays undecided when Protected is chosen without a guard, and shows the picker', async () => {
      server.use(contentGuardListHandler([customers]).handler);
      const reported: Protection[] = [];
      const { user } = renderWithProviders(<Harness reported={reported} />);

      await user.click(protectedRadio());

      expect(protectedRadio()).toBeChecked();
      expect(publicRadio()).not.toBeChecked();
      expect(reported).toStrictEqual([null]);
      expect(await picker()).toBeInTheDocument();
    });

    it('reports public when Public is chosen, and says what that means', async () => {
      const reported: Protection[] = [];
      const { user } = renderWithProviders(<Harness reported={reported} />);

      await user.click(publicRadio());

      expect(publicRadio()).toBeChecked();
      expect(reported).toStrictEqual(['public']);
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.getByText(/no content guard/)).toBeInTheDocument();
    });

    it('reports the guard that is picked, and goes back to undecided when the choice is cleared', async () => {
      server.use(contentGuardListHandler([customers, partners]).handler);
      const reported: Protection[] = [];
      const { user } = renderWithProviders(<Harness reported={reported} />);

      await user.click(protectedRadio());
      await user.click(await picker());
      await user.click(await screen.findByRole('option', { name: /partners/ }));

      expect(reported.at(-1)).toStrictEqual({ guard: partners.pulp_href });

      await user.click(screen.getByRole('button', { name: 'Clear' }));

      expect(reported.at(-1)).toBeNull();
      expect(protectedRadio()).toBeChecked();
    });

    it('drops the guard when Public is chosen after a guard', async () => {
      server.use(contentGuardListHandler([customers]).handler);
      const reported: Protection[] = [];
      const { user } = renderWithProviders(<Harness reported={reported} />);

      await user.click(protectedRadio());
      await user.click(await picker());
      await user.click(
        await screen.findByRole('option', { name: /customers/ }),
      );
      await user.click(publicRadio());

      expect(reported.at(-1)).toBe('public');
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('shows a value it is given: the guard radio with the guard named', async () => {
      server.use(contentGuardListHandler([customers]).handler);
      const reported: Protection[] = [];

      renderWithProviders(
        <Harness
          reported={reported}
          initial={{ guard: customers.pulp_href }}
        />,
      );

      expect(protectedRadio()).toBeChecked();
      expect(await screen.findByDisplayValue('customers')).toBeInTheDocument();
      expect(reported).toStrictEqual([]);
    });
  },
);

describe(
  'Integration: the content guard picker',
  { tags: ['integration'] },
  () => {
    it('asks the server for the typed text once the typing has paused, not for every key', async () => {
      const list = contentGuardListHandler([customers, partners]);
      server.use(list.handler);
      const { user } = renderWithProviders(
        <GuardField value={null} onChange={() => undefined} />,
      );

      await user.click(await picker());
      await user.type(await picker(), 'cust');

      await waitFor(() =>
        expect(
          list.queries.filter((query) => query.get('name__icontains')),
        ).toHaveLength(1),
      );
      const searched = list.queries.filter((query) =>
        query.has('name__icontains'),
      );
      expect(searched[0]?.get('name__icontains')).toBe('cust');
      expect(searched[0]?.get('limit')).toBe('20');
      expect(
        await screen.findByRole('option', { name: /customers/ }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /partners/ })).toBeNull();
    });

    it('shows each guard with its type', async () => {
      const guards = [
        contentGuard({ name: 'a-rbac', pulp_href: at('core/rbac', 1) }),
        contentGuard({ name: 'b-x509', pulp_href: at('certguard/x509', 2) }),
        contentGuard({ name: 'c-rhsm', pulp_href: at('certguard/rhsm', 3) }),
        contentGuard({ name: 'd-header', pulp_href: at('core/header', 4) }),
        contentGuard({
          name: 'e-composite',
          pulp_href: at('core/composite', 5),
        }),
        contentGuard({
          name: 'f-envvar',
          pulp_href: at('core/envvar_header', 6),
        }),
      ];
      server.use(contentGuardListHandler(guards).handler);
      const { user } = renderWithProviders(
        <GuardField value={null} onChange={() => undefined} />,
      );

      await user.click(await picker());

      const typeOf = async (name: RegExp) =>
        within(await screen.findByRole('option', { name })).getByText(
          /^(RBAC|X\.509 certificate|RHSM certificate|Header|Composite|envvar_header)$/,
        ).textContent;
      expect(await typeOf(/a-rbac/)).toBe('RBAC');
      expect(await typeOf(/b-x509/)).toBe('X.509 certificate');
      expect(await typeOf(/c-rhsm/)).toBe('RHSM certificate');
      expect(await typeOf(/d-header/)).toBe('Header');
      expect(await typeOf(/e-composite/)).toBe('Composite');
      expect(await typeOf(/f-envvar/)).toBe('envvar_header');
    });

    it('shows 20 of 35 matching guards and says that more match', async () => {
      const guards = Array.from({ length: 35 }, (_, index) =>
        contentGuard({
          name: `guard-${String(index).padStart(2, '0')}`,
          pulp_href: at('core/rbac', index + 1),
        }),
      );
      const list = contentGuardListHandler(guards);
      server.use(list.handler);
      const { user } = renderWithProviders(
        <GuardField value={null} onChange={() => undefined} />,
      );

      await user.click(await picker());

      expect(
        await screen.findByText('More guards match; type more of the name'),
      ).toBeInTheDocument();
      expect(await screen.findAllByRole('option')).toHaveLength(20);
      expect(list.queries.every((query) => query.get('limit') === '20')).toBe(
        true,
      );
    });

    it('does not say that more match when everything that matches is shown', async () => {
      server.use(contentGuardListHandler([customers, partners]).handler);
      const { user } = renderWithProviders(
        <GuardField value={null} onChange={() => undefined} />,
      );

      await user.click(await picker());

      await screen.findByRole('option', { name: /customers/ });
      expect(screen.queryByText(/More guards match/)).toBeNull();
    });

    it('names a guard the user may not see as such', async () => {
      server.use(contentGuardListHandler([customers]).handler);
      renderWithProviders(
        <GuardField value={at('core/rbac', 77)} onChange={() => undefined} />,
      );

      expect(
        await screen.findByDisplayValue('A content guard you may not see'),
      ).toBeInTheDocument();
    });

    it('says why the search failed, with Retry, and reads again on Retry', async () => {
      server.use(
        http.get(`*${GUARDS}`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );
      const { user } = renderWithProviders(
        <GuardField value={null} onChange={() => undefined} />,
      );

      expect(
        await screen.findByText(/Failed to load content guards/),
      ).toBeInTheDocument();

      server.use(contentGuardListHandler([customers]).handler);
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      await user.click(await picker());
      expect(
        await screen.findByRole('option', { name: /customers/ }),
      ).toBeInTheDocument();
    });
  },
);
