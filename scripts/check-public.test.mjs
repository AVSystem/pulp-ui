// @vitest-environment node
// Tests of the public-content guard. Fixtures use only reserved names. Names
// and addresses that must be flagged are assembled at run time, so this file
// itself never contains a flaggable literal and the guard stays green on it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildRules,
  isPrivateAddress,
  isReservedHost,
  loadDenylistText,
  parseDenylist,
  scan,
} from './check-public.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(HERE, '..', '.githooks');
const SCRIPT = join(HERE, 'check-public.mjs');
const INSTALLER = join(HERE, 'install-git-hooks.mjs');

const ip = (...octets) => octets.join('.');
const ip6 = (...groups) => groups.join(':');
// A name that is on no list and is not reserved.
const unlisted = ['unlisted', 'fixture', 'lan'].join('.');
const url = (host, path = '/') => 'https://' + host + path;

const rules = (hostsText = '', denylistText = null) =>
  buildRules({ hostsText, denylistText });
const rulesOf = (found) => found.map((f) => f.rule);
const tokensOf = (found) => found.map((f) => f.token);

describe('url-host rule', () => {
  it('flags a URL whose host is not listed', () => {
    const found = scan(`see ${url(unlisted)}`, 'a.ts', rules());
    expect(found).toEqual([
      { path: 'a.ts', line: 1, rule: 'url-host', token: unlisted },
    ]);
  });

  it('flags a public address used as a URL host', () => {
    const found = scan(url(ip(203, 0, 113, 5)), 'a.ts', rules());
    expect(rulesOf(found)).toEqual(['url-host']);
  });

  it('passes reserved names without any list', () => {
    const text = [
      'http://localhost:8080/x',
      'http://app.localhost/x',
      'https://example.com/',
      'https://docs.example.org/x',
      'https://shop.example.net/',
      'https://a.evil.example/',
      'https://b.service.test/',
      'https://c.invalid/',
      'http://' + ip(127, 0, 0, 1) + ':9000/',
      'http://' + ip(0, 0, 0, 0) + ':80/',
      'http://[::1]:3000/',
    ].join('\n');
    expect(scan(text, 'a.ts', rules())).toEqual([]);
    expect(isReservedHost('example.com.')).toBe(true);
    expect(isReservedHost(unlisted)).toBe(false);
  });

  it('matches the host list case-insensitively and ignores a trailing dot', () => {
    const listed = ['Mixed', 'Case', 'fixture', 'lan'].join('.');
    const r = rules(`${listed.toLowerCase()}\n`);
    expect(scan(url(listed.toUpperCase()), 'a.ts', r)).toEqual([]);
    expect(scan(url(`${listed}.`), 'a.ts', r)).toEqual([]);
    expect(scan(url(unlisted), 'a.ts', r)).toHaveLength(1);
    expect(
      rules(`${listed.toUpperCase()}\n`).hosts.exact.has(listed.toLowerCase()),
    ).toBe(true);
  });

  it('supports wildcard entries for subdomains only', () => {
    const r = rules(
      '# comment\n*.docs.example.invalid\n*.pub.fixture.lan # note\n',
    );
    const sub = ['a', 'pub', 'fixture', 'lan'].join('.');
    const apex = ['pub', 'fixture', 'lan'].join('.');
    expect(scan(url(sub), 'a.ts', r)).toEqual([]);
    expect(tokensOf(scan(url(apex), 'a.ts', r))).toEqual([apex]);
  });

  it('reads the host out of userinfo and port', () => {
    const dsn = ['postgres://', 'user:secret@', unlisted, ':5432/db'].join('');
    const found = scan(dsn, 'a.ts', rules());
    expect(tokensOf(found)).toEqual([unlisted]);
  });

  it('skips template placeholders instead of guessing a host', () => {
    expect(scan('http://${host}:8080/x', 'a.ts', rules())).toEqual([]);
    expect(scan('https://<host>/x', 'a.md', rules())).toEqual([]);
  });

  it('reports the line number', () => {
    const text = `one\ntwo\n${url(unlisted)}\n`;
    expect(scan(text, 'a.ts', rules())[0].line).toBe(3);
    expect(scan(text, 'a.ts', rules(), { firstLine: 40 })[0].line).toBe(42);
  });
});

describe('private-address rule', () => {
  it('flags every private range and its edges', () => {
    const hits = [
      ip(10, 0, 0, 1),
      ip(10, 255, 255, 255),
      ip(172, 16, 0, 1),
      ip(172, 31, 255, 254),
      ip(192, 168, 1, 10),
      ip(100, 64, 0, 1),
      ip(100, 127, 255, 254),
    ];
    for (const h of hits) {
      const found = scan(`connect to ${h} now`, 'a.ts', rules());
      expect(tokensOf(found)).toEqual([h]);
      expect(rulesOf(found)).toEqual(['private-address']);
    }
  });

  it('does not flag public or loopback addresses and near misses', () => {
    const misses = [
      ip(172, 15, 0, 1),
      ip(172, 32, 0, 1),
      ip(100, 63, 0, 1),
      ip(100, 128, 0, 1),
      ip(192, 169, 0, 1),
      ip(127, 0, 0, 1),
      ip(0, 0, 0, 0),
      ip(203, 0, 113, 9),
      ip(10, 0, 0, 256),
    ];
    for (const m of misses) {
      expect(scan(`addr ${m}`, 'a.ts', rules())).toEqual([]);
    }
  });

  it('flags an IPv6 unique local address', () => {
    const addr = ip6('fd12', '3456', '', '1');
    const found = scan(`listen [${addr}]:80`, 'a.ts', rules());
    expect(tokensOf(found)).toEqual([addr]);
    expect(isPrivateAddress(addr)).toBe(true);
    expect(isPrivateAddress(ip6('2001', 'db8', '', '1'))).toBe(false);
  });

  it('reports a private address used as a URL host once, as an address', () => {
    const found = scan(url(ip(192, 168, 0, 7)), 'a.ts', rules());
    expect(rulesOf(found)).toEqual(['private-address']);
  });
});

describe('denylist rule', () => {
  const list = '# internal names\nZzFixtureToken\nre:zz-[0-9]+-fixture\n\n';

  it('matches literal entries case-insensitively and prints the matched text', () => {
    const found = scan('uses ZZFIXTURETOKEN here', 'a.ts', rules('', list));
    expect(found).toEqual([
      { path: 'a.ts', line: 1, rule: 'denylist', token: 'ZZFIXTURETOKEN' },
    ]);
  });

  it('matches regular expression entries', () => {
    const found = scan('see ZZ-42-fixture', 'a.ts', rules('', list));
    expect(tokensOf(found)).toEqual(['ZZ-42-fixture']);
  });

  it('never reports entries that did not match', () => {
    const found = scan('uses zzfixturetoken here', 'a.ts', rules('', list));
    expect(JSON.stringify(found)).not.toContain('fixture\\\\');
    expect(JSON.stringify(found)).not.toContain('zz-[0-9]');
    expect(found).toHaveLength(1);
  });

  it('treats literal entries as text, not as patterns', () => {
    const found = scan('a-b and a.b', 'a.ts', rules('', 'a.b\n'));
    expect(tokensOf(found)).toEqual(['a.b']);
  });

  it('rejects an invalid expression without echoing it', () => {
    expect(() => parseDenylist('ok\nre:(unclosed\n')).toThrow(/line 2/);
    try {
      parseDenylist('re:(unclosed\n');
    } catch (err) {
      expect(String(err.message)).not.toContain('unclosed');
    }
  });

  it('fails closed when the configured file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-deny-'));
    try {
      expect(() =>
        loadDenylistText(dir, {
          PUBLIC_CHECK_DENYLIST: join(dir, 'missing.txt'),
        }),
      ).toThrow(/cannot be read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('lockfile rule', () => {
  it('checks resolved URLs and ignores funding URLs', () => {
    const lock = [
      '"funding": "https://' + unlisted + '/sponsor",',
      '"resolved": "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",',
    ].join('\n');
    expect(scan(lock, 'package-lock.json', rules())).toEqual([]);
  });

  it('flags a resolved URL on another registry', () => {
    const lock = '"resolved": "' + url(unlisted, '/pkg.tgz') + '",';
    expect(tokensOf(scan(lock, 'package-lock.json', rules()))).toEqual([
      unlisted,
    ]);
    expect(tokensOf(scan(lock, 'sub/package-lock.json', rules()))).toEqual([
      unlisted,
    ]);
  });
});

// Child processes see none of the outer git or guard configuration.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('GIT_') ||
      key === 'PUBLIC_CHECK_DENYLIST' ||
      key === 'CI'
    ) {
      delete env[key];
    }
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  };
}

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    ...options,
    env: cleanEnv(options.env),
  });
  return { ...res, output: `${res.stdout}${res.stderr}` };
}

function git(cwd, args, options = {}) {
  return run('git', args, { cwd, ...options });
}

function newRepo(root, name, { hooks = true } = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Fixture User']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  if (hooks) {
    git(dir, ['config', 'core.hooksPath', HOOKS]);
  }
  return dir;
}

describe('pre-commit hook in a real repository', () => {
  let root;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'guard-it-'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const commit = (dir, env) =>
    git(dir, ['commit', '-q', '-m', 'Add file'], { env });
  const stage = (dir, name, body) => {
    writeFileSync(join(dir, name), body);
    git(dir, ['add', name]);
  };

  it('refuses a commit that adds a URL on a host that is not listed', () => {
    const dir = newRepo(root, 'host');
    stage(dir, 'notes.ts', `const u = '${url(ip(203, 0, 113, 7), '/x')}';\n`);
    const res = commit(dir);
    expect(res.status).not.toBe(0);
    expect(res.output).toMatch(/notes\.ts:1: url-host: /);
  });

  it('refuses a commit that adds a private address', () => {
    const dir = newRepo(root, 'addr');
    stage(dir, 'notes.ts', `const a = '${ip(10, 1, 2, 3)}';\n`);
    const res = commit(dir);
    expect(res.status).not.toBe(0);
    expect(res.output).toMatch(/notes\.ts:1: private-address: /);
  });

  it('refuses a denylisted name in any case and prints no other entry', () => {
    const dir = newRepo(root, 'deny');
    const file = join(root, 'deny-list.txt');
    writeFileSync(file, 'zzfixturetoken\nzzunmatchedentry\n');
    stage(dir, 'notes.ts', '// uses ZZFIXTURETOKEN\n');
    const res = commit(dir, { PUBLIC_CHECK_DENYLIST: file });
    expect(res.status).not.toBe(0);
    expect(res.output).toMatch(/notes\.ts:1: denylist: ZZFIXTURETOKEN/);
    expect(res.output).not.toContain('zzunmatchedentry');
  });

  it('refuses a commit whose file path holds a denylisted name', () => {
    const dir = newRepo(root, 'denypath');
    const file = join(root, 'deny-path.txt');
    writeFileSync(file, 'zzpathtoken\n');
    stage(dir, 'zzpathtoken-notes.ts', 'export {};\n');
    const res = commit(dir, { PUBLIC_CHECK_DENYLIST: file });
    expect(res.status).not.toBe(0);
    expect(res.output).toMatch(
      /zzpathtoken-notes\.ts:0: denylist: zzpathtoken/,
    );
  });

  it('commits clean content and says the private list was not checked', () => {
    const dir = newRepo(root, 'clean');
    stage(
      dir,
      'notes.ts',
      `export const docs = '${url('docs.example.com')}';\n`,
    );
    const res = commit(dir);
    expect(res.status).toBe(0);
    expect(res.output).toMatch(/no private denylist configured/);
  });

  it('fails closed when the configured denylist file is missing', () => {
    const dir = newRepo(root, 'missing');
    stage(dir, 'notes.ts', 'export {};\n');
    const res = commit(dir, { PUBLIC_CHECK_DENYLIST: join(root, 'nope.txt') });
    expect(res.status).not.toBe(0);
    expect(res.output).toMatch(/cannot be read/);
  });

  it('reads the denylist path from git configuration', () => {
    const dir = newRepo(root, 'gitconfig');
    const file = join(root, 'deny-config.txt');
    writeFileSync(file, 'zzconfigtoken\n');
    git(dir, ['config', 'publiccheck.denylist', file]);
    stage(dir, 'notes.ts', '// zzconfigtoken\n');
    const res = commit(dir);
    expect(res.status).not.toBe(0);
    expect(res.output).toMatch(/: denylist: zzconfigtoken/);
  });

  it('exits 0 when nothing is staged', () => {
    const dir = newRepo(root, 'empty');
    const res = run('node', [SCRIPT, '--staged'], { cwd: dir });
    expect(res.status).toBe(0);
    expect(res.output).toBe('');
  });
});

describe('hook installer', () => {
  it('prints nothing and succeeds under CI', () => {
    const res = run('node', [INSTALLER], { env: { CI: '1' } });
    expect(res.status).toBe(0);
    expect(res.output).toBe('');
  });

  it('prints nothing outside a git work tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-nogit-'));
    try {
      const res = run('node', [INSTALLER], {
        cwd: dir,
        env: { GIT_CEILING_DIRECTORIES: dirname(dir) },
      });
      expect(res.status).toBe(0);
      expect(res.output).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets core.hooksPath in a work tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-inst-'));
    try {
      git(dir, ['init', '-q']);
      const res = run('node', [INSTALLER], { cwd: dir });
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/core\.hooksPath is \.githooks/);
      expect(git(dir, ['config', 'core.hooksPath']).stdout.trim()).toBe(
        '.githooks',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
