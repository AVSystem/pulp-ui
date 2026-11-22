import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { contentGuard, contentGuardListHandler } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { ContentGuardClient, guardKindOf } from './client';

const GUARDS = '/pulp/api/v3/contentguards/';

const at = (kind: string, id: number) =>
  `${GUARDS}${kind}/00000000-0000-4000-8000-${String(id).padStart(12, '0')}/`;

describe(
  'Integration: searching content guards by name',
  { tags: ['integration'] },
  () => {
    it('sends one request with the name filter, the limit, the name order, every type but the content redirect, and only the fields it shows', async () => {
      const list = contentGuardListHandler([
        contentGuard({ name: 'customers', pulp_href: at('core/rbac', 1) }),
      ]);
      server.use(list.handler);

      await ContentGuardClient.search('cust');

      expect(list.queries).toHaveLength(1);
      const query = list.queries[0] as URLSearchParams;
      expect(query.get('name__icontains')).toBe('cust');
      expect(query.get('limit')).toBe('20');
      expect(query.get('ordering')).toBe('name');
      expect(query.getAll('fields')).toStrictEqual([
        'pulp_href',
        'prn',
        'name',
      ]);
      const types = (query.get('pulp_type__in') ?? '').split(',');
      expect(types).toStrictEqual([
        'certguard.rhsm',
        'certguard.x509',
        'core.composite',
        'core.envvar_header',
        'core.header',
        'core.rbac',
      ]);
      expect(types).not.toContain('core.content_redirect');
    });

    it('sends no name filter for blank text, trims the text, and honours the limit it is given', async () => {
      const list = contentGuardListHandler([]);
      server.use(list.handler);

      await ContentGuardClient.search('   ');
      await ContentGuardClient.search('  cust  ', 5);

      expect(list.queries[0]?.has('name__icontains')).toBe(false);
      expect(list.queries[1]?.get('name__icontains')).toBe('cust');
      expect(list.queries[1]?.get('limit')).toBe('5');
    });

    it('answers the number that match with the rows of one page, and never the content redirect guard', async () => {
      const guards = Array.from({ length: 35 }, (_, index) =>
        contentGuard({
          name: `guard-${String(index).padStart(2, '0')}`,
          pulp_href: at('core/rbac', index + 1),
        }),
      );
      const redirect = contentGuard({
        name: 'content redirect',
        pulp_href: at('core/content_redirect', 99),
      });
      server.use(contentGuardListHandler([...guards, redirect]).handler);

      const found = await ContentGuardClient.search('');

      expect(found.count).toBe(35);
      expect(found.results).toHaveLength(20);
      expect(found.results[0]).toMatchObject({
        name: 'guard-00',
        pulp_href: at('core/rbac', 1),
      });
    });

    it('rejects when the server refuses, so the field can say so', async () => {
      server.use(
        http.get(`*${GUARDS}`, () =>
          HttpResponse.json({ detail: 'No.' }, { status: 403 }),
        ),
      );

      await expect(ContentGuardClient.search('x')).rejects.toBeDefined();
    });
  },
);

describe('Unit: the kind of a content guard', { tags: ['unit'] }, () => {
  it.each([
    ['core/rbac', 'rbac'],
    ['certguard/x509', 'x509'],
    ['certguard/rhsm', 'rhsm'],
    ['core/header', 'header'],
    ['core/composite', 'composite'],
  ])('reads %s as %s', (path, kind) => {
    expect(guardKindOf(at(path, 3))).toBe(kind);
  });
});
