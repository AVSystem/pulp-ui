import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ContentListParams, makeContentEntity } from './content';

// The content entity builds the request of a list from what a screen names.
// One kind of version filter at most goes with it: the version's content, what
// the version added or what it removed, or none for a list of all the content
// of the type the user may see.

const VERSION = '/pulp/api/v3/repositories/file/file/0192/versions/2/';

const entity = makeContentEntity({
  app: 'file',
  object: 'content',
  schema: z.looseObject({ pulp_href: z.string() }),
  textFilters: ['relative_path__contains'],
  api: {
    list: async () => ({ count: 0, results: [] }),
    listUrl: (params) =>
      `/content?${new URLSearchParams(
        Object.entries((params ?? {}) as Record<string, string>).map(
          ([key, value]) => [key, String(value)],
        ),
      )}`,
  },
});

const queryOf = (params: ContentListParams) =>
  new URL(entity.urlOf(params), 'http://localhost').searchParams;

describe(
  'Unit: the version filters of a content list',
  { tags: ['unit'] },
  () => {
    it('sends the version filter for the content of a version', () => {
      const query = queryOf({ repository_version: VERSION, page: 1 });

      expect(query.get('repository_version')).toBe(VERSION);
      expect(query.has('repository_version_added')).toBe(false);
      expect(query.has('repository_version_removed')).toBe(false);
    });

    it('sends only the added filter for what a version added', () => {
      const query = queryOf({ repository_version_added: VERSION });

      expect(query.get('repository_version_added')).toBe(VERSION);
      expect(query.has('repository_version')).toBe(false);
      expect(query.has('repository_version_removed')).toBe(false);
    });

    it('sends only the removed filter for what a version removed', () => {
      const query = queryOf({ repository_version_removed: VERSION });

      expect(query.get('repository_version_removed')).toBe(VERSION);
      expect(query.has('repository_version')).toBe(false);
      expect(query.has('repository_version_added')).toBe(false);
    });

    it('sends no version filter for a list without a version', () => {
      const query = queryOf({ page: 2, page_size: 20 });

      expect(query.has('repository_version')).toBe(false);
      expect(query.has('repository_version_added')).toBe(false);
      expect(query.has('repository_version_removed')).toBe(false);
      expect(query.get('offset')).toBe('20');
      expect(query.get('limit')).toBe('20');
    });

    it('still sends the type filters and the order with a version filter', () => {
      const query = queryOf({
        repository_version_added: VERSION,
        relative_path__contains: 'docs',
        sort: '-relative_path',
        fields: ['pulp_href'],
      });

      expect(query.get('relative_path__contains')).toBe('docs');
      expect(query.get('ordering')).toBe('-relative_path');
    });

    it('refuses two version filters at once, as a type error and at run time', async () => {
      const both = {
        repository_version: VERSION,
        repository_version_added: VERSION,
      };

      // @ts-expect-error a list takes one version filter at most
      const typed: ContentListParams = both;

      expect(() => entity.urlOf(typed)).toThrow(/one version filter/);
      await expect(
        entity.list({
          repository_version_added: VERSION,
          repository_version_removed: VERSION,
        } as unknown as ContentListParams),
      ).rejects.toThrow(/one version filter/);
    });

    it('treats an empty version filter as not set', () => {
      const query = queryOf({
        repository_version: '',
        repository_version_added: VERSION,
      } as unknown as ContentListParams);

      expect(query.get('repository_version_added')).toBe(VERSION);
    });
  },
);

describe('Unit: the labels of a content entity', { tags: ['unit'] }, () => {
  const UNIT = '/pulp/api/v3/content/file/files/0001/';

  it('has no label calls unless the content type gives them', () => {
    expect(entity.setLabel).toBeUndefined();
    expect(entity.unsetLabel).toBeUndefined();
  });

  it('sends the key and the value of a label to the unit and the key alone to remove it', async () => {
    const sent: unknown[][] = [];
    const labelled = makeContentEntity({
      app: 'file',
      object: 'content',
      schema: z.looseObject({ pulp_href: z.string() }),
      textFilters: ['relative_path__contains', 'pulp_label_select'],
      api: {
        list: async () => ({ count: 0, results: [] }),
        listUrl: () => '/content',
        setLabel: async (...args) => {
          sent.push(['set', ...args]);
          return { key: 'team', value: 'ops' };
        },
        unsetLabel: async (...args) => {
          sent.push(['unset', ...args]);
          return { key: 'team' };
        },
      },
    });

    await labelled.setLabel?.(UNIT, { key: 'team', value: 'ops' });
    await labelled.unsetLabel?.(UNIT, 'team');

    expect(sent).toEqual([
      ['set', UNIT, { key: 'team', value: 'ops' }, undefined],
      ['unset', UNIT, { key: 'team' }, undefined],
    ]);
  });

  it('sends the label selector of a list', () => {
    const labelled = makeContentEntity({
      app: 'file',
      object: 'content',
      schema: z.looseObject({ pulp_href: z.string() }),
      textFilters: ['pulp_label_select'],
      api: {
        list: async () => ({ count: 0, results: [] }),
        listUrl: (params) =>
          `/content?${new URLSearchParams(
            Object.entries((params ?? {}) as Record<string, string>).map(
              ([key, value]) => [key, String(value)],
            ),
          )}`,
      },
    });

    const query = new URL(
      labelled.urlOf({ pulp_label_select: 'team=ops' }),
      'http://localhost',
    ).searchParams;

    expect(query.get('pulp_label_select')).toBe('team=ops');
  });
});
