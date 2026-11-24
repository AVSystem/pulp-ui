import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError } from 'src/entities/response-shape';
import { listOf, signingService } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { requestErrorStatus } from 'src/utilities/request-error';
import { SigningServiceClient } from './client';

const SERVICES = '/pulp/api/v3/signing-services/';

describe(
  'Integration: listing the signing services',
  { tags: ['integration'] },
  () => {
    it('sends one request for a page: the offset, the limit, the order and the fields it shows', async () => {
      const list = listOf(SERVICES, [signingService({ name: 'zz-signer' })]);
      server.use(list.handler);

      await SigningServiceClient.list({
        page: 3,
        page_size: 20,
        sort: '-name',
      });

      expect(list.queries).toHaveLength(1);
      const query = list.queries[0] as URLSearchParams;
      expect(query.get('offset')).toBe('40');
      expect(query.get('limit')).toBe('20');
      expect(query.get('ordering')).toBe('-name');
      expect(query.has('name')).toBe(false);
    });

    it('never asks for the script of a service, only what the screen shows', async () => {
      const list = listOf(SERVICES, []);
      server.use(list.handler);

      await SigningServiceClient.list({ page: 1, page_size: 50, sort: 'name' });

      const fields = (list.queries[0] as URLSearchParams)
        .getAll('fields')
        .flatMap((field) => field.split(','));
      expect(fields.sort()).toStrictEqual([
        'name',
        'pubkey_fingerprint',
        'public_key',
        'pulp_created',
        'pulp_href',
      ]);
      expect(fields).not.toContain('script');
    });

    it('sends the name filter only when a name is given, as the server takes it', async () => {
      const list = listOf(SERVICES, []);
      server.use(list.handler);

      await SigningServiceClient.list({
        page: 1,
        page_size: 50,
        sort: 'name',
        name: 'zz-signer',
      });
      await SigningServiceClient.list({ page: 1, page_size: 50, sort: 'name' });

      expect(list.queries[0]?.get('name')).toBe('zz-signer');
      expect(list.queries[0]?.has('name__icontains')).toBe(false);
      expect(list.queries[1]?.has('name')).toBe(false);
    });

    it('answers the count and the rows of the page with the fields the screen shows', async () => {
      const rows = [
        signingService({ name: 'zz-a', pubkey_fingerprint: 'ABCD' }),
        signingService({ name: 'zz-b', public_key: 'zz key' }),
      ];
      server.use(listOf(SERVICES, rows).handler);

      const page = await SigningServiceClient.list({
        page: 1,
        page_size: 50,
        sort: 'name',
      });

      expect(page.count).toBe(2);
      expect(page.results.map(({ name }) => name)).toStrictEqual([
        'zz-a',
        'zz-b',
      ]);
      expect(page.results[0]?.pubkey_fingerprint).toBe('ABCD');
      expect(page.results[1]?.public_key).toBe('zz key');
    });

    it('rejects with the server failure and never answers an empty list for it', async () => {
      server.use(
        http.get(`*${SERVICES}`, () =>
          HttpResponse.json({ detail: 'boom' }, { status: 500 }),
        ),
      );

      const failure = await SigningServiceClient.list({
        page: 1,
        page_size: 50,
        sort: 'name',
      }).catch((error: unknown) => error);

      expect(requestErrorStatus(failure)).toBe(500);
    });

    it('rejects an answer whose rows have no usable address', async () => {
      server.use(
        http.get(`*${SERVICES}`, () =>
          HttpResponse.json({
            count: 1,
            next: null,
            previous: null,
            results: [
              { pulp_href: 'https://elsewhere.example.org/x/', name: 'a' },
            ],
          }),
        ),
      );

      await expect(
        SigningServiceClient.list({ page: 1, page_size: 50, sort: 'name' }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  },
);
