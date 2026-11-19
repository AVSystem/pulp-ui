// @vitest-environment node
// Tests of the schema import: normalising, the versions file and the command's
// exit codes. Fixtures are temporary directories, never the committed schema.
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  importSchema,
  normalise,
  parseSources,
  sortKeys,
  versionsOf,
} from './import-schema.mjs';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'import-schema.mjs',
);

const dump = () => ({
  servers: [{ url: 'http://localhost:24817/' }],
  paths: { '/b/': { get: { z: 1, a: 2 } }, '/a/': {} },
  openapi: '3.0.1',
  info: {
    title: 'Pulp 3 API',
    'x-pulp-app-versions': { rpm: '3.39.0', core: '3.120.0' },
    'x-pulp-image-sources': 'pulpcore@aaaa pulp_rpm@bbbb pulp-ui@cccc',
  },
  list: [{ b: 1, a: 2 }, 'keep', 3],
});

let dir;
let input;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'import-schema-'));
  input = join(dir, 'dump.json');
  mkdirSync(join(dir, 'out'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Unit: normalising', { tags: ['unit'] }, () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(
      JSON.stringify(sortKeys({ b: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }, 'x'] })),
    ).toBe('{"a":[{"y":2,"z":1},"x"],"b":{"c":2,"d":1}}');
  });

  it('drops the servers entry', () => {
    expect(normalise(dump())).not.toHaveProperty('servers');
  });

  it('splits the image sources into name and commit', () => {
    expect(parseSources('pulpcore@aaaa pulp-ui@cccc')).toStrictEqual({
      'pulp-ui': 'cccc',
      pulpcore: 'aaaa',
    });
    expect(parseSources(undefined)).toStrictEqual({});
    expect(() => parseSources('pulpcore')).toThrow(/name@commit/);
  });

  it('refuses a schema without application versions', () => {
    expect(() => versionsOf({ info: {} })).toThrow(/x-pulp-app-versions/);
  });
});

describe('Integration: importSchema', { tags: ['integration'] }, () => {
  it('writes the normalised schema and the versions file', () => {
    writeFileSync(input, JSON.stringify(dump()));

    importSchema(input, join(dir, 'out'));

    const schemaText = readFileSync(
      join(dir, 'out', 'schema', 'pulp.json'),
      'utf8',
    );
    const schema = JSON.parse(schemaText);
    expect(schema).not.toHaveProperty('servers');
    expect(Object.keys(schema)).toStrictEqual([
      'info',
      'list',
      'openapi',
      'paths',
    ]);
    expect(Object.keys(schema.paths)).toStrictEqual(['/a/', '/b/']);
    expect(schemaText.startsWith('{\n  "info"')).toBe(true);
    expect(schemaText.endsWith('}\n')).toBe(true);
    expect(
      JSON.parse(readFileSync(join(dir, 'out', 'pulp-versions.json'), 'utf8')),
    ).toStrictEqual({
      apps: { core: '3.120.0', rpm: '3.39.0' },
      sources: { 'pulp-ui': 'cccc', pulp_rpm: 'bbbb', pulpcore: 'aaaa' },
    });
  });

  it('carries no timestamp and gives identical bytes when run twice', () => {
    writeFileSync(input, JSON.stringify(dump()));

    importSchema(input, join(dir, 'out'));
    const first = [
      readFileSync(join(dir, 'out', 'schema', 'pulp.json'), 'utf8'),
      readFileSync(join(dir, 'out', 'pulp-versions.json'), 'utf8'),
    ];
    importSchema(input, join(dir, 'out'));
    const second = [
      readFileSync(join(dir, 'out', 'schema', 'pulp.json'), 'utf8'),
      readFileSync(join(dir, 'out', 'pulp-versions.json'), 'utf8'),
    ];

    expect(second).toStrictEqual(first);
    expect(first[1]).not.toMatch(/generatedAt|time|date/i);
  });

  it('gives the same bytes for a dump with a different key order', () => {
    writeFileSync(input, JSON.stringify(dump()));
    importSchema(input, join(dir, 'out'));
    const first = readFileSync(join(dir, 'out', 'schema', 'pulp.json'), 'utf8');

    const reordered = Object.fromEntries(Object.entries(dump()).reverse());
    writeFileSync(input, JSON.stringify(reordered));
    importSchema(input, join(dir, 'out'));

    expect(readFileSync(join(dir, 'out', 'schema', 'pulp.json'), 'utf8')).toBe(
      first,
    );
  });
});

describe('Integration: the command', { tags: ['integration'] }, () => {
  it('exits 2 with a usage line when no file is given', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Usage/);
  });

  it('exits 1 when the schema has no application versions', () => {
    writeFileSync(
      input,
      JSON.stringify({ openapi: '3.0.1', info: {}, paths: {} }),
    );

    const result = spawnSync(process.execPath, [SCRIPT, input], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/x-pulp-app-versions/);
  });
});
