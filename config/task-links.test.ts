// @vitest-environment node
// A task is held by its pulp_href and addressed by its id, and only
// src/entities/core/task/href.ts turns the one into the other. A link built
// anywhere else would carry its own idea of what a task id looks like, and a
// change of the address would have to be found by hand. This test reads the
// source of the application and fails for a task link that does not take its
// id from taskUrlId, and for a path to a task assembled from text.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
// The entities own the mapping. The legacy request layer is frozen and builds
// its own request paths from ids; it is not a place where a link is made.
const EXEMPT = [join(SRC, 'entities'), join(SRC, 'api')];

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

// A call that builds the address of a task detail, with what it passes as the
// task. The second pattern finds a path to a task put together as text: a
// string that holds "tasks/" next to an interpolated id or a concatenation.
const DETAIL_CALL =
  /formatPath\(\s*Paths\.core\.task\.detail\s*,\s*\{\s*task\s*:\s*([^}]*?)\s*,?\s*\}/g;
const ASSEMBLED_PATH = [
  /`[^`]*\btasks\/\$\{/,
  /['"][^'"`\n]*\btasks\/['"]\s*\+/,
  /\+\s*['"]\/?tasks\/['"]/,
];

function findings(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(DETAIL_CALL)) {
    if (!/^taskUrlId\(/.test(match[1])) {
      found.push(
        `the task of a detail link is "${match[1]}", not taskUrlId(...)`,
      );
    }
  }
  const assembled = ASSEMBLED_PATH.map((pattern) => pattern.exec(source)).find(
    Boolean,
  );
  if (assembled) {
    found.push(`a path to a task is assembled from text: ${assembled[0]}`);
  }

  return found;
}

describe('task links', { tags: ['unit'] }, () => {
  it('takes the id of every task link from taskUrlId', () => {
    expect(
      findings(
        'formatPath(Paths.core.task.detail, { task: taskUrlId(task.pulp_href) })',
      ),
    ).toEqual([]);
    expect(
      findings(
        'formatPath(Paths.core.task.detail, {\n  task: taskUrlId(href),\n})',
      ),
    ).toEqual([]);
  });

  it('reports a link whose id is read some other way', () => {
    expect(
      findings(
        'formatPath(Paths.core.task.detail, { task: parsePulpIDFromURL(href) })',
      ),
    ).toHaveLength(1);
    expect(
      findings('formatPath(Paths.core.task.detail, { task: taskId })'),
    ).toHaveLength(1);
  });

  it('reports a path to a task put together as text', () => {
    expect(findings('const path = `/pulp/api/v3/tasks/${id}/`;')).toHaveLength(
      1,
    );
    expect(findings("const path = base + 'tasks/' + id;")).toHaveLength(1);
    expect(findings("const path = '/tasks/' + id;")).toHaveLength(1);
  });

  it('leaves a page that only mentions tasks alone', () => {
    expect(findings("const label = 'tasks/second';")).toEqual([]);
    expect(findings('const title = t`Task management`;')).toEqual([]);
  });

  it('finds no such link anywhere in the application outside src/entities', () => {
    const offending = sourceFiles(SRC).flatMap((file) =>
      findings(readFileSync(file, 'utf8')).map(
        (finding) => `${relative(ROOT, file)}: ${finding}`,
      ),
    );

    expect(offending).toEqual([]);
  });
});
