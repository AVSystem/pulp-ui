// @vitest-environment node
// src/api is the legacy request layer: it keeps serving the screens that have
// not moved yet and is not extended. A new request is written as an entity
// under src/entities, which checks the shape of the answer and talks to the
// generated client. This test compares what src/api exports now with the list
// in frozen-api.json, which names every file, every exported name and the
// members of every exported class and object. Anything the list lacks fails;
// removing something never does, so migrating a screen away from src/api only
// ever shrinks the surface. After a removal the list may be trimmed by hand.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const API_DIR = join(ROOT, 'src', 'api');

// file -> exported name -> sorted member names (empty when the export has no
// members: a function, an enum, an interface, a type, a re-export; only a
// class and an object literal have members that can be requests).
type Surface = Record<string, Record<string, string[]>>;

// BEGIN surface
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(join(dir, entry.name))
        : [join(dir, entry.name)],
    )
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));
}

function memberName(name: ts.PropertyName | undefined): string | null {
  if (
    name &&
    (ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name))
  ) {
    return name.text;
  }
  return null;
}

function members(node: ts.Node | undefined): string[] {
  const names: (string | null)[] = [];
  if (node && ts.isClassLike(node)) {
    for (const member of node.members) {
      names.push(memberName(member.name as ts.PropertyName | undefined));
    }
  } else if (node && ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      names.push(memberName(property.name));
    }
  }
  return names.filter((name): name is string => name !== null).sort();
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function exportsOf(file: ts.SourceFile): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const node of file.statements) {
    if (ts.isExportDeclaration(node) && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        for (const specifier of node.exportClause.elements) {
          found[specifier.name.text] = [];
        }
      }
    } else if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          found[declaration.name.text] = members(declaration.initializer);
        }
      }
    } else if (
      isExported(node) &&
      (ts.isClassDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) &&
      node.name
    ) {
      found[node.name.text] = ts.isEnumDeclaration(node)
        ? []
        : members(node as ts.Node);
    }
  }
  return found;
}

function readSurface(): Surface {
  const surface: Surface = {};
  for (const path of sourceFiles(API_DIR).sort()) {
    const file = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const names = exportsOf(file);
    surface[relative(API_DIR, path).split('\\').join('/')] = Object.fromEntries(
      Object.keys(names)
        .sort()
        .map((name) => [name, names[name]]),
    );
  }
  return surface;
}
// END surface

// Everything the current surface has that the frozen one lacks.
function additions(current: Surface, frozen: Surface): string[] {
  const added: string[] = [];
  for (const [file, exported] of Object.entries(current)) {
    if (!(file in frozen)) {
      added.push(`new file src/api/${file}`);
      continue;
    }
    for (const [name, names] of Object.entries(exported)) {
      if (!(name in frozen[file])) {
        added.push(`new export ${name} in src/api/${file}`);
        continue;
      }
      for (const member of names) {
        if (!frozen[file][name].includes(member)) {
          added.push(`new member ${name}.${member} in src/api/${file}`);
        }
      }
    }
  }
  return added;
}

function failureMessage(added: string[]): string {
  return [
    'src/api is frozen: it serves the screens that have not moved yet and is not extended.',
    'Write the new request as an entity under src/entities instead. Not in the frozen list:',
    ...added.map((line) => `  - ${line}`),
  ].join('\n');
}

describe('the surface reader', () => {
  const frozen: Surface = {
    'user.ts': { UserAPI: ['get', 'list'], UserType: ['id', 'name'] },
  };

  it('reports a new file', () => {
    expect(
      additions({ ...frozen, 'group.ts': { GroupAPI: ['list'] } }, frozen),
    ).toEqual(['new file src/api/group.ts']);
  });

  it('reports a new export', () => {
    expect(
      additions({ 'user.ts': { ...frozen['user.ts'], helper: [] } }, frozen),
    ).toEqual(['new export helper in src/api/user.ts']);
  });

  it('reports a new method of an exported object', () => {
    expect(
      additions(
        {
          'user.ts': {
            ...frozen['user.ts'],
            UserAPI: ['delete', 'get', 'list'],
          },
        },
        frozen,
      ),
    ).toEqual(['new member UserAPI.delete in src/api/user.ts']);
  });

  it('lets a removal pass', () => {
    expect(additions({ 'user.ts': { UserAPI: ['get'] } }, frozen)).toEqual([]);
    expect(additions({}, frozen)).toEqual([]);
  });

  it('names the entity layer in the failure message', () => {
    const message = failureMessage(['new file src/api/group.ts']);

    expect(message).toContain('src/api is frozen');
    expect(message).toContain('src/entities');
    expect(message).toContain('new file src/api/group.ts');
  });

  it('reads classes, object literals, enums and re-exports from source', () => {
    const file = ts.createSourceFile(
      'sample.ts',
      [
        "export { Other, type OtherType } from './other';",
        'export class A { id: string; list() {} static make() {} }',
        "export const B = { get: () => 1, 'quoted-name': 2, list() {} };",
        'export enum C { One, Two }',
        'export interface D { name: string }',
        'export function e() {}',
        'const hidden = { x: 1 };',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );

    expect(exportsOf(file)).toEqual({
      Other: [],
      OtherType: [],
      A: ['id', 'list', 'make'],
      B: ['get', 'list', 'quoted-name'],
      C: [],
      D: [],
      e: [],
    });
  });
});

describe('src/api', () => {
  it('has no file, export or method the frozen list lacks', () => {
    const frozen = JSON.parse(
      readFileSync(join(import.meta.dirname, 'frozen-api.json'), 'utf8'),
    ) as Surface;
    const added = additions(readSurface(), frozen);

    expect(added, failureMessage(added)).toEqual([]);
  });
});
