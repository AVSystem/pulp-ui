import { describe, expect, it } from 'vitest';
import { contentUrlPrefix, resolveDistribution } from './distribution-option';

describe(
  'Unit: the distribution of the create form',
  { tags: ['unit'] },
  () => {
    it('follows the name for the base path until one is typed', () => {
      expect(
        resolveDistribution('My Tools', { ticked: true }, [], true).basePath,
      ).toBe('My_Tools');
      expect(
        resolveDistribution(
          'My Tools',
          { ticked: true, typedBasePath: 'tools' },
          [],
          true,
        ).basePath,
      ).toBe('tools');
    });

    it('asks for nothing while the box is not ticked, or the option is not offered', () => {
      expect(
        resolveDistribution('tools', { ticked: false }, ['tools/'], true),
      ).toMatchObject({ request: null, blocked: false });
      expect(
        resolveDistribution('tools', { ticked: true }, ['tools/'], false),
      ).toMatchObject({ request: null, blocked: false });
    });

    it('blocks a base path a rule refuses or a reserved prefix covers', () => {
      expect(
        resolveDistribution(
          'a b',
          { ticked: true, typedBasePath: 'a b' },
          [],
          true,
        ),
      ).toMatchObject({ problem: 'characters', blocked: true });
      expect(
        resolveDistribution(
          'x',
          { ticked: true, typedBasePath: 'res/x' },
          ['res/'],
          true,
        ),
      ).toMatchObject({ reserved: 'res/', blocked: true });
      expect(
        resolveDistribution(
          'x',
          { ticked: true, typedBasePath: 'res/x' },
          null,
          true,
        ),
      ).toMatchObject({ reserved: null, blocked: false });
    });

    it('builds the address of the content app from the status', () => {
      expect(
        contentUrlPrefix({
          content_settings: {
            content_origin: 'https://pulp.example/',
            content_path_prefix: '/pulp/content/',
          },
        }),
      ).toBe('https://pulp.example/pulp/content/');
      expect(
        contentUrlPrefix({
          content_settings: { content_origin: 'https://pulp.example' },
        }),
      ).toBe('https://pulp.example/');
      expect(contentUrlPrefix({})).toBeNull();
      expect(contentUrlPrefix(undefined)).toBeNull();
    });
  },
);
