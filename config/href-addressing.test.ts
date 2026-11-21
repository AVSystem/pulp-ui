// @vitest-environment node
// An object is held by its pulp_href, and only src/entities turns an id into an
// address or an address into an id. A request path built from an id by hand
// names whatever the id says (a value cut out of an address, or typed into the
// address bar), and an address taken apart by hand carries its own idea of how
// an address is shaped. This test reads the source of the application and
// fails for either, for a call of the removed id parser, and for an id
// interpolated into a path of the request layer.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
// The entities own the mapping. The test helpers build addresses for fixtures
// and are not part of the running application.
const EXEMPT = [join(SRC, 'entities'), join(SRC, 'test-utils')];
const API = join(SRC, 'api');

// An identifier that stands for an id: id, pk, uuid, pulpId or anything that
// ends in Id (taskId, userId).
const ID_NAME = String.raw`(?:id|pk|uuid|pulpId|\w+Id)`;

interface Rule {
  name: string;
  pattern: RegExp;
  // true: the rule applies to the request layer only
  api?: boolean;
  // true: the rule is about an id in a path, which an allowlist entry covers
  id?: boolean;
}

const RULES: Rule[] = [
  {
    name: 'an import of the removed id parser',
    pattern:
      /(?:from|import\(|require\()\s*['"][^'"]*parse-pulp-id['"]|\bparsePulpID\w*|\btranslatePulpResourceToURL\b/,
  },
  {
    // `.../${id}/` and `/${id}`: the id sits next to a slash of a path
    name: 'an id interpolated next to a slash of a path',
    pattern: new RegExp(
      String.raw`\$\{[^}]*\b${ID_NAME}\b[^}]*\}\/|\/\$\{[^}]*\b${ID_NAME}\b[^}]*\}`,
    ),
    id: true,
  },
  {
    name: 'an address taken apart at its slashes',
    pattern:
      /[\w$]*(?:href|Href|HREF)[\w$]*(?:\??\.[\w$]+\([^()]*\))*\??\.split\(\s*['"`]\/['"`]\s*\)/,
  },
  {
    // A request path of src/api names its object through an address, so no id
    // is interpolated into any string there, slash or not.
    name: 'an id interpolated into a request path',
    pattern: new RegExp(String.raw`\$\{[^}]*\b${ID_NAME}\b[^}]*\}`),
    api: true,
    id: true,
  },
];

// A request path of src/api that may hold an interpolated id, with the reason.
// Each entry names the file and the exact text it may contain.
const API_ALLOWLIST: { file: string; text: string; why: string }[] = [];

function findings(
  source: string,
  { inApi = false, file = '' }: { inApi?: boolean; file?: string } = {},
): string[] {
  const allowed = API_ALLOWLIST.filter((entry) => entry.file === file).map(
    (entry) => entry.text,
  );

  return source.split('\n').flatMap((line, index) =>
    RULES.filter((rule) => !rule.api || inApi)
      .filter((rule) => rule.pattern.test(line))
      .filter(
        (rule) => !(rule.id && allowed.some((text) => line.includes(text))),
      )
      .map((rule) => `line ${index + 1}: ${rule.name}: ${line.trim()}`),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return EXEMPT.includes(path) ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe('the patterns that guard href addressing', { tags: ['unit'] }, () => {
  it.each([
    ["import { parsePulpResource } from 'src/utilities/parse-pulp-id';"],
    ["import { parsePulpResource } from './parse-pulp-id';"],
    ["export { x } from '../utilities/parse-pulp-id';"],
    ["const m = await import('src/utilities/parse-pulp-id');"],
    ["const m = require('./parse-pulp-id');"],
    ['const id = parsePulpIDFromURL(href);'],
    ['const id = parsePulpIDFromPRN(prn);'],
    ['const url = translatePulpResourceToURL(resource);'],
  ])('reports the removed parser: %s', (source) => {
    expect(findings(source).join('\n')).toMatch(/removed id parser/);
  });

  it.each([
    ['const path = `/pulp/api/v3/tasks/${id}/`;'],
    ['const path = `groups/${groupId}/users/`;'],
    ['const path = `${base}/${row.pk}`;'],
    ['const path = `repositories/${pulpId}/versions/`;'],
    ['const path = `x/${data.uuid}/y`;'],
    ['const path = `${task.id}/cancel/`;'],
    ['const path = `users/${user.id}/`;'],
    ['const path = `a/${String(taskId)}/`;'],
  ])('reports an id placed next to a slash: %s', (source) => {
    expect(findings(source).join('\n')).toMatch(
      /id interpolated next to a slash/,
    );
  });

  it.each([
    ["const parts = href.split('/');"],
    ["const last = row.pulp_href.split('/').pop();"],
    ["const id = pulpHref.split('/').filter(Boolean).pop();"],
    ["const id = latest_version_href.replace(/\\/$/, '').split('/').pop();"],
    ['const parts = repository?.pulp_href?.split("/");'],
    ['const parts = data.versionHref.split(`/`);'],
  ])('reports an address taken apart: %s', (source) => {
    expect(findings(source).join('\n')).toMatch(/taken apart at its slashes/);
  });

  it.each([
    ['const path = `groups/${id}/`;'],
    ['const path = `groups/${groupId}/roles/`;'],
    ['const path = `${path}roles/${role.id}`;'],
    ['const p = `users/${ id }`;'],
  ])('reports an id in a request path of src/api: %s', (source) => {
    expect(findings(source, { inApi: true }).join('\n')).toMatch(
      /id interpolated into a request path/,
    );
  });

  it('lets a request path of src/api hold the text its allowlist entry names', () => {
    API_ALLOWLIST.push({
      file: 'fixture.ts',
      text: '`collections/${collectionId}/`',
      why: 'a fixture entry that names a path the test allows',
    });
    try {
      const line = 'const p = `collections/${collectionId}/`;';
      expect(findings(line, { inApi: true, file: 'fixture.ts' })).toEqual([]);
      // the entry covers its file and its text, nothing else
      expect(findings(line, { inApi: true, file: 'other.ts' })).not.toEqual([]);
      expect(
        findings('const p = `groups/${id}/`;', {
          inApi: true,
          file: 'fixture.ts',
        }),
      ).not.toEqual([]);
    } finally {
      API_ALLOWLIST.pop();
    }
  });

  it('gives every allowlist entry a reason', () => {
    for (const entry of API_ALLOWLIST) {
      expect(entry.why.length).toBeGreaterThan(10);
    }
  });

  it.each([
    ['const path = formatPath(Paths.core.task.detail, { task: taskId });'],
    ['const label = t`Task ${name}`;'],
    ['const path = `${config.API_BASE_PATH}${kind}/`;'],
    ['const path = `/repositories/${name}/`;'],
    ['const id = uuid();'],
    ["const parts = text.split('/');"],
    ["const parts = path.split('/').filter(Boolean);"],
    ['const valid = `${validation}/x`;'],
    ['const css = `${width}px`;'],
    ["const x = href.split('?')[0];"],
    ['const bits = hrefs.map((value) => value.trim());'],
  ])('leaves ordinary code alone: %s', (source) => {
    expect(findings(source)).toEqual([]);
    expect(findings(source, { inApi: true })).toEqual([]);
  });

  it('lets the request layer pass the path it was given', () => {
    expect(
      findings('at(href, (path) => base.http.post(`${path}add_role/`, role))', {
        inApi: true,
      }),
    ).toEqual([]);
  });
});

describe('href addressing in the application', { tags: ['unit'] }, () => {
  it('finds no id turned into an address, and no address taken apart, outside src/entities', () => {
    const offending = sourceFiles(SRC).flatMap((file) =>
      findings(readFileSync(file, 'utf8'), {
        inApi: file.startsWith(`${API}/`),
        file: relative(ROOT, file),
      }).map((found) => `${relative(ROOT, file)}: ${found}`),
    );

    expect(offending).toEqual([]);
  });

  it('has no module of the removed id parser', () => {
    expect(() =>
      readFileSync(join(SRC, 'utilities', 'parse-pulp-id.ts')),
    ).toThrow(/ENOENT/);
  });
});
