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

  it('refuses a list with no active entry', () => {
    for (const text of ['', '\n\n', '# comment only\n\n  \n', '\r\n#x\r\n']) {
      expect(() => rules('', text)).toThrow(/holds no entries/);
    }
    expect(() => rules('', 'entry\n')).not.toThrow();
    expect(rules('', null).denylist).toBeNull();
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

describe('prose rule', () => {
  const host = ['unlisted', 'fixture', 'lan'].join('.');

  it('flags a bare host in a prose file only', () => {
    const text = `Open ${host} in a browser`;
    expect(rulesOf(scan(text, 'notes.md', rules()))).toEqual(['bare-host']);
    expect(scan(text, 'notes.yml', rules())).toHaveLength(1);
    expect(scan(text, 'notes.txt', rules())).toHaveLength(1);
    expect(scan(text, 'notes.po', rules())).toHaveLength(1);
    expect(scan(text, 'index.html', rules())).toHaveLength(1);
    expect(scan(text, 'notes.ts', rules())).toEqual([]);
    expect(scan(text, 'notes.mjs', rules())).toEqual([]);
  });

  it('passes listed and reserved hosts and does not repeat a URL finding', () => {
    expect(scan(`see ${host}`, 'n.md', rules(`${host}\n`))).toEqual([]);
    expect(scan('see docs.example.com and a.test', 'n.md', rules())).toEqual(
      [],
    );
    const found = scan(`see ${url(host, '/a.org')}`, 'n.md', rules());
    expect(rulesOf(found)).toEqual(['url-host']);
  });

  it('flags the domain of an email address', () => {
    const found = scan(`mail someone@${host}`, 'n.md', rules());
    expect(tokensOf(found)).toEqual([host]);
  });
});

describe('noise classes', () => {
  it('ignores version strings that look like addresses', () => {
    const text = [
      'node 10.13.0 and 1.2.3.4',
      'v' + ip(10, 1, 2, 3),
      'pkg@' + ip(10, 1, 2, 3),
      '^' + ip(172, 16, 0, 1),
      'release ' + ip(10, 1, 2, 3) + '-beta.1',
    ].join('\n');
    expect(scan(text, 'a.ts', rules())).toEqual([]);
    expect(scan(text, 'a.md', rules())).toEqual([]);
  });

  it('ignores dotted identifiers and file names', () => {
    const code = 'const a = item.name + config.ui + this.state.id + obj.pk;';
    expect(scan(code, 'a.ts', rules())).toEqual([]);
    const prose =
      'See `item.name`, `config.ui`, README.md, build.sh and a.b.c.';
    expect(scan(prose, 'a.md', rules())).toEqual([]);
  });

  it('ignores reserved example names and loopback in prose and code', () => {
    const text =
      'try https://api.example.org/x, localhost:8080 and evil.example';
    expect(scan(text, 'a.md', rules())).toEqual([]);
    expect(scan(text, 'a.ts', rules())).toEqual([]);
  });

  it('ignores lockfile funding URLs', () => {
    const lock = '"funding": { "url": "https://' + 'x' + '.invalid/sponsor" }';
    expect(scan(lock, 'package-lock.json', rules())).toEqual([]);
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
    expect(res.output).toMatch(/no private denylist configured/);
  });

  it('warns on every run when no denylist is configured, even with nothing to scan', () => {
    const dir = newRepo(root, 'warn-hooks');
    const pre = run('sh', [join(HOOKS, 'pre-commit')], { cwd: dir });
    expect(pre.status).toBe(0);
    expect(pre.stderr).toMatch(/no private denylist configured/);
    const push = run('sh', [join(HOOKS, 'pre-push'), 'origin', 'none'], {
      cwd: dir,
      input: '',
    });
    expect(push.status).toBe(0);
    expect(push.stderr).toMatch(/no private denylist configured/);
  });

  it('refuses a configured denylist that holds no entries and names the setting', () => {
    const dir = newRepo(root, 'empty-list');
    const file = join(root, 'deny-empty.txt');
    writeFileSync(file, '# only a comment zzcommenttext\n\n   \n');
    stage(dir, 'notes.ts', '// zzanything\n');
    const res = commit(dir, { PUBLIC_CHECK_DENYLIST: file });
    expect(res.status).not.toBe(0);
    expect(res.output).toMatch(/PUBLIC_CHECK_DENYLIST/);
    expect(res.output).toMatch(/publiccheck\.denylist/);
    expect(res.output).toMatch(/holds no entries/);
    expect(res.output).not.toContain('zzcommenttext');
    writeFileSync(file, '');
    expect(commit(dir, { PUBLIC_CHECK_DENYLIST: file }).status).not.toBe(0);
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

describe('modes in real repositories', () => {
  let root;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'guard-modes-'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const leak = `const u = '${url(ip(203, 0, 113, 7), '/x')}';\n`;
  const write = (dir, name, body) => writeFileSync(join(dir, name), body);
  const commitAll = (dir, message, extra = []) => {
    git(dir, ['add', '-A']);
    const res = git(dir, ['commit', '-q', '-m', message, ...extra]);
    expect(res.status, res.output).toBe(0);
    return git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  };
  const check = (dir, args, options = {}) =>
    run('node', [SCRIPT, ...args], { cwd: dir, ...options });

  it('--all scans every tracked file and the empty tree is clean', () => {
    const dir = newRepo(root, 'all', { hooks: false });
    expect(check(dir, ['--all']).status).toBe(0);
    write(dir, 'ok.ts', 'export {};\n');
    commitAll(dir, 'Add ok');
    expect(check(dir, ['--all']).status).toBe(0);
    write(dir, 'bad.ts', `export {};\n${leak}`);
    commitAll(dir, 'Add bad');
    const res = check(dir, ['--all']);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/^bad\.ts:2: url-host: /m);
  });

  it('--all fails closed when the configured denylist is missing', () => {
    const dir = newRepo(root, 'all-missing', { hooks: false });
    write(dir, 'ok.ts', 'export {};\n');
    commitAll(dir, 'Add ok');
    const res = check(dir, ['--all'], {
      env: { PUBLIC_CHECK_DENYLIST: join(root, 'absent.txt') },
    });
    expect(res.status).toBe(1);
    expect(res.output).toMatch(/cannot be read/);
  });

  it('--range scans each commit, so content added and removed is still found', () => {
    const dir = newRepo(root, 'range', { hooks: false });
    write(dir, 'a.ts', 'export {};\n');
    const base = commitAll(dir, 'Base');
    write(dir, 'a.ts', leak);
    commitAll(dir, 'Add leak');
    write(dir, 'a.ts', 'export {};\n');
    commitAll(dir, 'Remove it again');
    const res = check(dir, ['--range', `${base}..HEAD`]);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/^a\.ts:1: url-host: /m);
    expect(res.stderr).toMatch(/offending commits: [0-9a-f]{12}/);
    expect(check(dir, ['--range', 'HEAD..HEAD']).status).toBe(0);
  });

  it('--range scans commit messages and added paths', () => {
    const dir = newRepo(root, 'range-msg', { hooks: false });
    write(dir, 'a.ts', 'export {};\n');
    const base = commitAll(dir, 'Base');
    write(dir, 'b.ts', 'export {};\n');
    commitAll(
      dir,
      `Deploy to ${url(['unlisted', 'fixture', 'lan'].join('.'))}`,
    );
    const res = check(dir, ['--range', `${base}..HEAD`]);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/^commit:[0-9a-f]{12}:1: url-host: /m);

    const denyFile = join(root, 'range-deny.txt');
    writeFileSync(denyFile, 'zzrangetoken\n');
    write(dir, 'zzrangetoken.ts', 'export {};\n');
    const head = commitAll(dir, 'Add a file');
    const res2 = check(dir, ['--range', `${head}~1..${head}`], {
      env: { PUBLIC_CHECK_DENYLIST: denyFile },
    });
    expect(res2.status).toBe(1);
    expect(res2.stdout).toMatch(/^zzrangetoken\.ts:0: denylist: zzrangetoken/m);
  });

  it('scans a NUL-bearing file in --all and in a staged change', () => {
    const dir = newRepo(root, 'binary', { hooks: false });
    const body = Buffer.concat([
      Buffer.from('host ' + ip(10, 1, 2, 3) + ' here\n'),
      Buffer.from([0, 1, 2, 0]),
    ]);
    writeFileSync(join(dir, 'blob.bin'), body);
    git(dir, ['add', 'blob.bin']);
    const staged = run('node', [SCRIPT, '--staged'], { cwd: dir });
    expect(staged.status).toBe(1);
    expect(staged.stdout).toMatch(/^blob\.bin:1: private-address: /m);
    const res = git(dir, ['commit', '-q', '-m', 'Add blob']);
    expect(res.status, res.output).toBe(0);
    const all = check(dir, ['--all']);
    expect(all.status).toBe(1);
    expect(all.stdout).toMatch(/^blob\.bin:1: private-address: /m);
    const head = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
    const ranged = check(dir, ['--range', `${head}^!`]);
    expect(ranged.status).toBe(1);
    expect(ranged.stdout).toMatch(/^blob\.bin:1: private-address: /m);
  });

  it('scans a file marked -diff in .gitattributes', () => {
    const dir = newRepo(root, 'nodiff', { hooks: false });
    write(dir, '.gitattributes', '*.md -diff\n');
    write(dir, 'notes.md', 'host ' + ip(10, 1, 2, 3) + ' here\n');
    git(dir, ['add', '.gitattributes', 'notes.md']);
    const staged = run('node', [SCRIPT, '--staged'], { cwd: dir });
    expect(staged.status).toBe(1);
    expect(staged.stdout).toMatch(/^notes\.md:1: private-address: /m);
    const res = git(dir, ['commit', '-q', '-m', 'Add notes']);
    expect(res.status, res.output).toBe(0);
    const head = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
    const range = check(dir, ['--range', `${head}^!`]);
    expect(range.status).toBe(1);
    expect(range.stdout).toMatch(/^notes\.md:1: private-address: /m);
  });

  it('does not mistake an added line that starts with plus signs for a header', () => {
    const dir = newRepo(root, 'plus', { hooks: false });
    write(dir, 'a.ts', 'export {};\n');
    const base = commitAll(dir, 'Base');
    write(dir, 'a.ts', `export {};\n++ b/other.ts\n${leak}`);
    commitAll(dir, 'Add lines');
    const res = check(dir, ['--range', `${base}..HEAD`]);
    expect(res.stdout).toMatch(/^a\.ts:3: url-host: /m);
  });

  describe('pre-push', () => {
    const ZERO = '0'.repeat(40);

    function pushSetup(name) {
      const remote = join(root, `${name}-remote.git`);
      mkdirSync(remote);
      git(remote, ['init', '-q', '--bare', '-b', 'main']);
      const dir = newRepo(root, name, { hooks: false });
      git(dir, ['remote', 'add', 'origin', remote]);
      write(dir, 'a.ts', 'export {};\n');
      commitAll(dir, 'Base');
      expect(git(dir, ['push', '-q', 'origin', 'main']).status).toBe(0);
      return { dir, remote };
    }
    // Hooks are enabled only for the push itself, so a commit that carries a
    // leak can be created first.
    const push = (dir, args) =>
      git(dir, ['-c', `core.hooksPath=${HOOKS}`, 'push', ...args]);
    const remoteHead = (remote, ref) =>
      git(remote, ['rev-parse', '--verify', '-q', ref]).stdout.trim();

    it('exits 0 for a deleted ref and for an empty push', () => {
      const dir = newRepo(root, 'push-delete', { hooks: false });
      const del = `refs/heads/x ${ZERO} refs/heads/x ${'1'.repeat(40)}\n`;
      const r1 = check(dir, ['--pre-push', 'origin', 'url'], { input: del });
      expect(r1.status).toBe(0);
      const r2 = check(dir, ['--pre-push', 'origin', 'url'], { input: '' });
      expect(r2.status).toBe(0);
    });

    it('refuses a push of an existing branch that adds a leak', () => {
      const { dir, remote } = pushSetup('push-existing');
      const before = remoteHead(remote, 'main');
      write(dir, 'a.ts', leak);
      commitAll(dir, 'Add leak');
      const res = push(dir, ['origin', 'main']);
      expect(res.status).not.toBe(0);
      expect(res.output).toMatch(/a\.ts:1: url-host: /);
      expect(remoteHead(remote, 'main')).toBe(before);
    });

    it('refuses a new branch that carries a leak and accepts a clean one', () => {
      const { dir, remote } = pushSetup('push-new');
      git(dir, ['switch', '-q', '-c', 'feature']);
      write(dir, 'b.ts', leak);
      commitAll(dir, 'Add leak');
      const bad = push(dir, ['origin', 'feature']);
      expect(bad.status).not.toBe(0);
      expect(bad.output).toMatch(/b\.ts:1: url-host: /);
      expect(remoteHead(remote, 'refs/heads/feature')).toBe('');

      git(dir, ['switch', '-q', '-c', 'clean', 'main']);
      write(dir, 'c.ts', 'export const c = 1;\n');
      commitAll(dir, 'Add clean file');
      const ok = push(dir, ['origin', 'clean']);
      expect(ok.status, ok.output).toBe(0);
      expect(remoteHead(remote, 'refs/heads/clean')).not.toBe('');
    });

    it('refuses a push whose commit message carries a leak', () => {
      const { dir } = pushSetup('push-message');
      write(dir, 'c.ts', 'export {};\n');
      commitAll(
        dir,
        `Deploy to ${url(['unlisted', 'fixture', 'lan'].join('.'))}`,
      );
      const res = push(dir, ['origin', 'main']);
      expect(res.status).not.toBe(0);
      expect(res.output).toMatch(/commit:[0-9a-f]{12}:1: url-host: /);
    });

    it('pushes a branch deletion without scanning', () => {
      const { dir, remote } = pushSetup('push-del');
      git(dir, ['push', '-q', 'origin', 'main:refs/heads/gone']);
      expect(remoteHead(remote, 'refs/heads/gone')).not.toBe('');
      const res = push(dir, ['origin', ':refs/heads/gone']);
      expect(res.status, res.output).toBe(0);
      expect(remoteHead(remote, 'refs/heads/gone')).toBe('');
    });
  });
});
