#!/usr/bin/env node
// Public-content guard for this repository.
//
// This repository is public: whatever is committed and pushed is published at
// once. The guard refuses content that would reveal where or how a deployment
// runs, before it leaves the developer machine, and runs again in CI over the
// whole tree and every pushed range as a backstop.
//
// Rules (a finding is printed as "path:line: rule: token", exit status 1):
//   url-host         a URL (scheme, then host) whose host is neither on the public
//                    host list (scripts/public-hosts.txt) nor a reserved name
//                    (localhost, example.com/.net/.org, *.example, *.test,
//                    *.invalid, loopback).
//   private-address  an IPv4 address in 10/8, 172.16/12, 192.168/16 or
//                    100.64/10, or an IPv6 unique local address (the fc00/7 block),
//                    written as a whole token.
//   bare-host        a dotted host-like token ending in a real top-level
//                    domain that is not on the host list. Checked in prose
//                    files only (markdown, yaml, text, po, html): in code,
//                    member accesses and file names would drown it.
//   denylist         a case-insensitive match of an entry of the private
//                    denylist: literal substrings, or "re:" lines holding a
//                    regular expression. Entries that did not match are never
//                    printed, so the output cannot reveal the list.
//
// The host list is a list of hostnames as written in source text. It does not
// decide who may read or write anything; access is decided by the service
// itself.
//
// package-lock.json is checked on its "resolved" lines only, which must point
// at the public npm registry; its funding and homepage URLs are ignored.
//
// Private denylist: a file kept outside the repository, named by the
// PUBLIC_CHECK_DENYLIST environment variable or by the git configuration key
// publiccheck.denylist. When it is configured but cannot be read, or holds no
// entry (empty, or only comments and blank lines), the guard fails closed
// (exit 1): a list that matches nothing would otherwise pass everything in
// silence. When nothing is configured only the public rules run and one line
// on standard error says so on every run; CI has no list and relies on that.
//
// Usage:
//   node scripts/check-public.mjs --staged
//       added lines and added or renamed paths of the staged changes
//   node scripts/check-public.mjs --pre-push <remote-name> [<remote-url>]
//       commits about to be pushed; reads the hook standard input
//   node scripts/check-public.mjs --range <A>..<B>
//       every commit of the range: added lines, added paths, message
//   node scripts/check-public.mjs --all
//       the content and path of every tracked file
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isIPv6 } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HOSTS_FILE = join(SCRIPT_DIR, 'public-hosts.txt');

const PROSE_EXTENSIONS = new Set([
  '.md',
  '.yml',
  '.yaml',
  '.txt',
  '.po',
  '.pot',
  '.html',
]);

// Names that can never identify a real machine (RFC 2606, RFC 6761) plus
// loopback. example.com, .net and .org match with every subdomain.
const RESERVED_TLDS = new Set(['example', 'test', 'invalid', 'localhost']);
const RESERVED_APEXES = ['example.com', 'example.net', 'example.org'];

// Hosts used by the lockfile rule: packages must come from the public registry.
const LOCKFILE_HOSTS = new Set(['registry.npmjs.org']);

// Schemes whose "host" part is not a machine name.
const IGNORED_SCHEMES = new Set([
  'file',
  'webpack',
  'chrome-extension',
  'moz-extension',
  'vscode',
  'node',
  'npm',
]);

// Top-level domains accepted by the bare-host rule. A token with two labels
// must end in a core domain; a token with three or more labels may end in any
// of the broader set. Two-letter country codes that are also common file
// extensions or identifier tails (md, sh, py, pl, rs, so, in, id, ...) are
// left out on purpose: they would flag file names and member accesses, and the
// private denylist covers internal names that end in them.
const CORE_TLDS = new Set([
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'int',
  'info',
  'io',
  'cloud',
  'local',
  'internal',
  'lan',
  'corp',
  'intranet',
  'private',
  'localdomain',
]);
const BROAD_TLDS = new Set([
  ...CORE_TLDS,
  'mil',
  'biz',
  'dev',
  'app',
  'online',
  'site',
  'tech',
  'xyz',
  'top',
  'club',
  'shop',
  'store',
  'blog',
  'live',
  'co',
  'eu',
  'uk',
  'de',
  'fr',
  'nl',
  'ch',
  'cz',
  'sk',
  'si',
  'hu',
  'ro',
  'bg',
  'ru',
  'ua',
  'jp',
  'cn',
  'kr',
  'se',
  'fi',
  'dk',
  'ie',
  'es',
  'pt',
  'gr',
  'tr',
  'br',
  'au',
  'nz',
  'ca',
  'za',
  'mx',
  'ar',
  'cl',
  'hr',
]);

const URL_RE =
  /\b([a-z][a-z0-9+.-]*):\/\/(?:[^\s/?#@"'`<>()[\]{}\\]*@)?(\[[0-9a-f:.]+\]|[^\s/:?#"'`<>()[\]\\@,;]+)(?::\d+)?/gi;
const PROTOCOL_RELATIVE_RE =
  /(?<![\w:/.])\/\/((?:[a-z0-9-]+\.)+[a-z]{2,24})(?=[/:?#"'\s]|$)/gi;
const SCP_RE = /\b[\w.-]+@((?:[a-z0-9-]+\.)+[a-z]{2,24}):(?=[\w~/])/gi;
const URL_SPAN_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)\]}]*/gi;
const IPV4_RE = /(?<![\w.@^~])(\d{1,3}(?:\.\d{1,3}){3})(?![\w-]|\.\w)/g;
const IPV6_ULA_RE =
  /(?<![\w:.])f[cd][0-9a-f]{2}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi;
const BARE_HOST_RE =
  /(?<![\w./\\-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})(?![\w-]|\.\w)/gi;
const TEMPLATE_CHARS_RE = /[${}%*<>()\\^|`]/;

const MAX_TOKEN = 200;

/** One host as compared everywhere: lowercase, no brackets, no trailing dot. */
export function normalizeHost(host) {
  let h = host.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }
  if (h.endsWith('.')) {
    h = h.slice(0, -1);
  }
  return h;
}

/** Parses the host list text: one host per line, "*.domain" wildcards, "#" comments. */
export function parseHostList(text) {
  const exact = new Set();
  const suffixes = [];
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/(^|\s)#.*$/, '')
      .trim()
      .toLowerCase();
    if (!line) {
      continue;
    }
    if (line.startsWith('*.')) {
      suffixes.push(line.slice(1));
    } else {
      exact.add(normalizeHost(line));
    }
  }
  return { exact, suffixes };
}

/**
 * Parses the denylist text. Returns case-insensitive regular expressions; a
 * literal line is escaped. A line that is not a valid expression is an error
 * that names only its line number.
 */
export function parseDenylist(text) {
  const regexes = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    try {
      if (line.startsWith('re:')) {
        regexes.push(new RegExp(line.slice(3), 'i'));
      } else {
        regexes.push(
          new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        );
      }
    } catch {
      throw new Error(
        `denylist line ${i + 1} is not a valid regular expression`,
      );
    }
  }
  return regexes;
}

/** Builds the rule set used by scan(). Both arguments are optional text. */
export function buildRules({ hostsText = '', denylistText = null } = {}) {
  let denylist = null;
  if (denylistText !== null) {
    denylist = parseDenylist(denylistText);
    if (denylist.length === 0) {
      throw new Error(
        'the private denylist (PUBLIC_CHECK_DENYLIST or git config ' +
          'publiccheck.denylist) is configured but holds no entries',
      );
    }
  }
  return { hosts: parseHostList(hostsText), denylist };
}

function ipv4Octets(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) {
    return null;
  }
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function isPrivateIpv4(o) {
  const [a, b] = o;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpv6(host) {
  return isIPv6(host) && /^f[cd][0-9a-f]{2}:/i.test(host);
}

/** True for an address in a private range (the private-address rule owns these). */
export function isPrivateAddress(host) {
  const h = normalizeHost(host);
  const o = ipv4Octets(h);
  return o ? isPrivateIpv4(o) : isPrivateIpv6(h);
}

/** True for names and addresses that cannot identify a real machine. */
export function isReservedHost(host) {
  const h = normalizeHost(host);
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') {
    return true;
  }
  const o = ipv4Octets(h);
  if (o) {
    return o[0] === 127;
  }
  const tld = h.slice(h.lastIndexOf('.') + 1);
  if (RESERVED_TLDS.has(tld)) {
    return true;
  }
  return RESERVED_APEXES.some((apex) => h === apex || h.endsWith(`.${apex}`));
}

function onHostList(host, list) {
  const h = normalizeHost(host);
  return list.exact.has(h) || list.suffixes.some((s) => h.endsWith(s));
}

/** True when the host may appear in a URL: reserved, or on the list. */
export function isPublicHost(host, list) {
  return isReservedHost(host) || onHostList(host, list);
}

function kindOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base === 'package-lock.json') {
    return 'lockfile';
  }
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  return PROSE_EXTENSIONS.has(ext) ? 'prose' : 'code';
}

function clip(token) {
  return token.length > MAX_TOKEN ? `${token.slice(0, MAX_TOKEN)}...` : token;
}

function blankUrls(line) {
  return line.replace(URL_SPAN_RE, (m) => ' '.repeat(m.length));
}

function isBareHostCandidate(token) {
  const labels = token.toLowerCase().split('.');
  const tld = labels[labels.length - 1];
  return labels.length === 2 ? CORE_TLDS.has(tld) : BROAD_TLDS.has(tld);
}

/**
 * Scans text and returns findings {path, line, rule, token}.
 *
 * `path` selects the rule set: package-lock.json is checked on its "resolved"
 * lines only; prose files also get the bare-host rule. `options.kind` forces
 * "prose", "code" or "lockfile" (commit messages are prose); `options.firstLine`
 * is the number of the first line of `text`.
 */
export function scan(text, path, rules, options = {}) {
  const kind = options.kind ?? kindOf(path);
  const firstLine = options.firstLine ?? 1;
  const findings = [];
  const seen = new Set();
  const hostList =
    kind === 'lockfile' ? { exact: LOCKFILE_HOSTS, suffixes: [] } : rules.hosts;

  const add = (line, rule, token) => {
    const key = `${line}\u0000${rule}\u0000${token}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ path, line, rule, token: clip(token) });
    }
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, '');
    const lineNo = firstLine + i;
    if (kind === 'lockfile' && !line.includes('"resolved"')) {
      continue;
    }

    const checkHost = (rawHost) => {
      if (TEMPLATE_CHARS_RE.test(rawHost) || !/[a-z0-9]/i.test(rawHost)) {
        return;
      }
      const host = normalizeHost(rawHost);
      if (isPrivateAddress(host)) {
        return;
      }
      if (kind === 'lockfile') {
        if (!onHostList(host, hostList)) {
          add(lineNo, 'url-host', host);
        }
      } else if (!isPublicHost(host, hostList)) {
        add(lineNo, 'url-host', host);
      }
    };

    for (const m of line.matchAll(URL_RE)) {
      if (!IGNORED_SCHEMES.has(m[1].toLowerCase())) {
        checkHost(m[2]);
      }
    }
    if (kind !== 'lockfile') {
      for (const m of line.matchAll(PROTOCOL_RELATIVE_RE)) {
        checkHost(m[1]);
      }
      for (const m of line.matchAll(SCP_RE)) {
        checkHost(m[1]);
      }
    }

    for (const m of line.matchAll(IPV4_RE)) {
      const o = ipv4Octets(m[1]);
      if (o && isPrivateIpv4(o)) {
        add(lineNo, 'private-address', m[1]);
      }
    }
    for (const m of line.matchAll(IPV6_ULA_RE)) {
      if (isIPv6(m[0])) {
        add(lineNo, 'private-address', m[0]);
      }
    }

    if (kind === 'prose') {
      for (const m of blankUrls(line).matchAll(BARE_HOST_RE)) {
        if (isBareHostCandidate(m[1]) && !isPublicHost(m[1], hostList)) {
          add(lineNo, 'bare-host', normalizeHost(m[1]));
        }
      }
    }

    if (rules.denylist) {
      for (const re of rules.denylist) {
        const m = re.exec(line);
        if (m && m[0]) {
          add(lineNo, 'denylist', m[0]);
        }
      }
    }
  }
  return findings;
}

/** Scans one path name. Only the denylist applies to a path. */
export function scanPath(path, rules) {
  const findings = [];
  if (rules.denylist) {
    for (const re of rules.denylist) {
      const m = re.exec(path);
      if (m && m[0]) {
        findings.push({ path, line: 0, rule: 'denylist', token: clip(m[0]) });
      }
    }
  }
  return findings;
}

function unquotePath(s) {
  if (!(s.startsWith('"') && s.endsWith('"') && s.length >= 2)) {
    return s;
  }
  const bytes = [];
  const inner = s.slice(1, -1);
  const simple = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    '\\': 92,
  };
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else {
      bytes.push(simple[inner[i + 1]] ?? inner.charCodeAt(i + 1));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function headerPath(rest) {
  // "a/P b/P" for a path that is the same on both sides (new and deleted files).
  if (rest.startsWith('"')) {
    return null;
  }
  const n = (rest.length - 5) / 2;
  if (Number.isInteger(n) && n > 0) {
    const left = rest.slice(2, 2 + n);
    const right = rest.slice(5 + n);
    if (rest.startsWith('a/') && left === right) {
      return left;
    }
  }
  return null;
}

/**
 * Parses unified diff text made with -U0 and explicit a/ b/ prefixes into
 * files {path, isNew, hunks: [{start, lines}]}. isNew marks added, renamed and
 * copied paths. Hunk bodies are consumed by their line counts, so an added line
 * that starts with "++" is never mistaken for a file header.
 */
export function parseDiff(diff) {
  const files = [];
  let file = null;
  let oldLeft = 0;
  let newLeft = 0;
  let hunk = null;
  for (const raw of diff.split('\n')) {
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      if (raw.startsWith('+')) {
        hunk.lines.push(raw.slice(1));
        newLeft -= 1;
      } else if (raw.startsWith('-')) {
        oldLeft -= 1;
      }
      continue;
    }
    if (raw.startsWith('diff --git ')) {
      file = {
        path: headerPath(raw.slice('diff --git '.length)),
        isNew: false,
        hunks: [],
      };
      files.push(file);
      hunk = null;
    } else if (!file) {
      continue;
    } else if (raw.startsWith('new file mode')) {
      file.isNew = true;
    } else if (raw.startsWith('rename to ') || raw.startsWith('copy to ')) {
      file.isNew = true;
      file.path = unquotePath(raw.slice(raw.indexOf(' to ') + 4));
    } else if (raw.startsWith('+++ ')) {
      const target = raw.slice(4).replace(/\t.*$/, '');
      if (target !== '/dev/null') {
        const p = unquotePath(target);
        file.path = p.startsWith('b/') ? p.slice(2) : p;
      }
    } else if (raw.startsWith('@@ ')) {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (m) {
        oldLeft = m[1] === undefined ? 1 : Number(m[1]);
        newLeft = m[3] === undefined ? 1 : Number(m[3]);
        hunk = { start: Number(m[2]), lines: [] };
        file.hunks.push(hunk);
      }
    }
  }
  return files;
}

/** Scans the added lines and the added or renamed paths of a parsed diff. */
export function scanDiff(diff, rules) {
  const findings = [];
  for (const file of parseDiff(diff)) {
    if (!file.path) {
      continue;
    }
    if (file.isNew) {
      findings.push(...scanPath(file.path, rules));
    }
    for (const h of file.hunks) {
      if (h.lines.length > 0) {
        findings.push(
          ...scan(h.lines.join('\n'), file.path, rules, { firstLine: h.start }),
        );
      }
    }
  }
  return findings;
}

function git(args, cwd, input) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// --text makes git emit hunks for every file. Without it a file with a NUL
// byte, or one marked "-diff" in .gitattributes, is reported as binary and its
// content would never be scanned. --no-textconv keeps a configured conversion
// filter from replacing the committed bytes with other text.
const DIFF_FLAGS = [
  '-U0',
  '-M',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--text',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

function scanCommit(sha, rules, cwd) {
  const label = `commit:${sha.slice(0, 12)}`;
  const findings = scan(
    git(['log', '-1', '--format=%B', sha], cwd),
    label,
    rules,
    {
      kind: 'prose',
    },
  );
  // A merge commit adds nothing of its own except conflict resolutions; its
  // parents are scanned as commits of their own.
  const parents =
    git(['rev-list', '--parents', '-n', '1', sha], cwd).trim().split(' ')
      .length - 1;
  if (parents <= 1) {
    const diff = git(
      [
        '-c',
        'core.quotePath=false',
        'diff-tree',
        '-p',
        '-r',
        '--root',
        '--no-commit-id',
        ...DIFF_FLAGS,
        sha,
      ],
      cwd,
    );
    findings.push(...scanDiff(diff, rules));
  }
  return findings;
}

function scanCommits(shas, rules, cwd) {
  const findings = [];
  const offending = [];
  for (const sha of shas) {
    const found = scanCommit(sha, rules, cwd);
    if (found.length > 0) {
      offending.push(sha.slice(0, 12));
      findings.push(...found);
    }
  }
  return { findings, offending, scanned: shas.length };
}

function scanStaged(rules, cwd) {
  const diff = git(
    [
      '-c',
      'core.quotePath=false',
      'diff',
      '--cached',
      '--diff-filter=ACMR',
      ...DIFF_FLAGS,
    ],
    cwd,
  );
  return {
    findings: scanDiff(diff, rules),
    offending: [],
    scanned: diff ? 1 : 0,
  };
}

function scanAll(rules, cwd) {
  const paths = git(['ls-files', '-z'], cwd).split('\0').filter(Boolean);
  const findings = [];
  for (const path of paths) {
    findings.push(...scanPath(path, rules));
    let buf;
    try {
      buf = readFileSync(join(cwd, path));
    } catch {
      continue;
    }
    // A NUL byte does not make a file safe to publish: decode such a file one
    // byte per character so any address or name inside it is still seen.
    findings.push(
      ...scan(buf.toString(buf.includes(0) ? 'latin1' : 'utf8'), path, rules),
    );
  }
  return { findings, offending: [], scanned: paths.length };
}

const ZERO = /^0+$/;

function revisionExists(rev, cwd) {
  try {
    git(['cat-file', '-e', `${rev}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

function scanPrePush(remoteName, stdin, rules, cwd) {
  const shas = [];
  for (const line of stdin.split('\n').filter(Boolean)) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) {
      continue; // a deleted ref ships nothing
    }
    const known =
      remoteSha && !ZERO.test(remoteSha) && revisionExists(remoteSha, cwd);
    const args = known
      ? ['rev-list', '--reverse', `${remoteSha}..${localSha}`]
      : ['rev-list', '--reverse', localSha, '--not', `--remotes=${remoteName}`];
    for (const sha of git(args, cwd).split('\n').filter(Boolean)) {
      if (!shas.includes(sha)) {
        shas.push(sha);
      }
    }
  }
  return scanCommits(shas, rules, cwd);
}

function scanRange(range, rules, cwd) {
  const shas = git(['rev-list', '--reverse', range], cwd)
    .split('\n')
    .filter(Boolean);
  return scanCommits(shas, rules, cwd);
}

function expandHome(p) {
  return p.startsWith('~/') && process.env.HOME
    ? join(process.env.HOME, p.slice(2))
    : p;
}

/**
 * Locates and reads the private denylist. Returns null when none is
 * configured; throws when one is configured but cannot be read.
 */
export function loadDenylistText(cwd, env = process.env) {
  let configured = env.PUBLIC_CHECK_DENYLIST;
  if (!configured) {
    try {
      configured = git(['config', '--get', 'publiccheck.denylist'], cwd).trim();
    } catch {
      configured = '';
    }
  }
  if (!configured) {
    return null;
  }
  const file = expandHome(configured);
  try {
    return readFileSync(resolve(cwd, file), 'utf8');
  } catch {
    throw new Error(
      `the private denylist is configured but cannot be read: ${file}`,
    );
  }
}

function usage() {
  process.stderr.write(
    'usage: check-public.mjs --staged | --pre-push <remote> [<url>] | --range A..B | --all\n',
  );
  return 2;
}

/** Runs the CLI and returns the exit status. */
export function main(argv) {
  const [mode, ...rest] = argv;
  if (!['--staged', '--pre-push', '--range', '--all'].includes(mode)) {
    return usage();
  }
  if (mode === '--range' && !/^[^\s]+$/.test(rest[0] ?? '')) {
    return usage();
  }
  try {
    const cwd = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
    const denylistText = loadDenylistText(cwd);
    const rules = buildRules({
      hostsText: readFileSync(HOSTS_FILE, 'utf8'),
      denylistText,
    });

    let result;
    if (mode === '--staged') {
      result = scanStaged(rules, cwd);
    } else if (mode === '--pre-push') {
      result = scanPrePush(
        rest[0] ?? 'origin',
        readFileSync(0, 'utf8'),
        rules,
        cwd,
      );
    } else if (mode === '--range') {
      result = scanRange(rest[0], rules, cwd);
    } else {
      result = scanAll(rules, cwd);
    }

    if (denylistText === null) {
      process.stderr.write(
        'check-public: no private denylist configured; only the public rules ran\n',
      );
    }
    for (const f of result.findings) {
      process.stdout.write(`${f.path}:${f.line}: ${f.rule}: ${f.token}\n`);
    }
    if (result.findings.length > 0) {
      if (result.offending.length > 0) {
        process.stderr.write(
          `check-public: offending commits: ${result.offending.join(' ')}\n`,
        );
      }
      process.stderr.write(
        `check-public: ${result.findings.length} finding(s). Remove the content; ` +
          'do not bypass the check, because a push publishes it.\n',
      );
      return 1;
    }
    return 0;
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String(err.stderr).trim()
        : '';
    process.stderr.write(
      `check-public: ${err instanceof Error ? err.message : err}${stderr ? `\n${stderr}` : ''}\n`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
