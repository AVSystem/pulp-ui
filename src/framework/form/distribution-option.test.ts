import { describe, expect, it } from 'vitest';
import {
  type Protection,
  contentGuardOf,
} from '../distributions/protection-choice';
import { contentUrlPrefix, resolveDistribution } from './distribution-option';

const GUARD = '/pulp/api/v3/contentguards/core/rbac/1/';

const resolvedWith = (protection: Protection | undefined, ticked = true) =>
  resolveDistribution('tools', { ticked, protection }, [], true);

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
          { ticked: true, typedBasePath: 'a b', protection: 'public' },
          [],
          true,
        ),
      ).toMatchObject({ problem: 'characters', blocked: true });
      expect(
        resolveDistribution(
          'x',
          { ticked: true, typedBasePath: 'res/x', protection: 'public' },
          ['res/'],
          true,
        ),
      ).toMatchObject({ reserved: 'res/', blocked: true });
      expect(
        resolveDistribution(
          'x',
          { ticked: true, typedBasePath: 'res/x', protection: 'public' },
          null,
          true,
        ),
      ).toMatchObject({ reserved: null, blocked: false });
    });

    it('blocks while the protection is undecided, and asks for nothing yet', () => {
      expect(resolvedWith(null)).toMatchObject({
        blocked: true,
        undecided: true,
        request: null,
      });
      expect(resolvedWith(undefined)).toMatchObject({
        blocked: true,
        undecided: true,
        request: null,
      });
    });

    it('asks for a public distribution only when Public was chosen', () => {
      expect(resolvedWith('public')).toMatchObject({
        blocked: false,
        undecided: false,
        request: { basePath: 'tools', protection: 'public' },
      });
    });

    it('asks for the chosen guard, and is not blocked by the missing choice', () => {
      expect(resolvedWith({ guard: GUARD })).toMatchObject({
        blocked: false,
        request: { basePath: 'tools', protection: { guard: GUARD } },
      });
    });

    it('does not ask for a protection while the box is not ticked', () => {
      expect(resolvedWith(null, false)).toMatchObject({
        blocked: false,
        undecided: false,
        request: null,
      });
    });

    it('maps only the Public choice to a null content guard', () => {
      expect(contentGuardOf('public')).toBeNull();
      expect(contentGuardOf({ guard: GUARD })).toBe(GUARD);
      expect(() => contentGuardOf(null as never)).toThrow(/protection/);
      expect(() => contentGuardOf(undefined as never)).toThrow(/protection/);
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
