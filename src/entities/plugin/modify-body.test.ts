import { describe, expect, it } from 'vitest';
import { removeContentBody, revertBody } from './repository';

// What a change of a repository's content sends. A removal names the units to
// take out and nothing else: a base version would make the server start the new
// version from that version's content, so the removal would act on the wrong
// content. Only a revert sends one.

const VERSION = '/pulp/api/v3/repositories/file/file/0192/versions/1/';
const UNITS = [
  '/pulp/api/v3/content/file/files/0001/',
  '/pulp/api/v3/content/file/files/0002/',
];

describe(
  'Unit: the body of a change of repository content',
  { tags: ['unit'] },
  () => {
    it('names the units to remove and no base version', () => {
      const body = removeContentBody(UNITS);

      expect(body).toStrictEqual({ remove_content_units: UNITS });
      expect(Object.keys(body)).toEqual(['remove_content_units']);
      expect('base_version' in body).toBe(false);
    });

    it('copies the addresses, so a later change of the selection cannot reach a body in flight', () => {
      const picked = [...UNITS];
      const body = removeContentBody(picked);

      picked.push('/pulp/api/v3/content/file/files/0003/');

      expect(body.remove_content_units).toEqual(UNITS);
    });

    it('keeps the base version for a revert and sends nothing else', () => {
      const body = revertBody(VERSION);

      expect(body).toStrictEqual({ base_version: VERSION });
      expect(Object.keys(body)).toEqual(['base_version']);
    });
  },
);
