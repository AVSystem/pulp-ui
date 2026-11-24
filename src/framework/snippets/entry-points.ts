import { config } from 'src/ui-config';

// The addresses a deployment gives its clients, when they differ from the one
// the server reports for a distribution: one public address that fronts several
// distributions, a customer host, a write address for uploads. They come from
// the deployment's configuration (the key CLIENT_ENTRY_POINTS) and nowhere
// else, so the interface itself names no host.
export interface ClientEntryPoint {
  // The plugin whose distributions the entry is for, for example `python`.
  plugin: string;
  // The distributions the entry is for: those whose base path is listed, or
  // starts with the prefix. An entry that names neither matches nothing.
  basePaths?: string[];
  basePathPrefix?: string;
  // Where clients read. `{base_path}` stands for the distribution's base path;
  // a relative address resolves against the page origin.
  read: string;
  // Where clients write (upload), when that differs from where they read.
  write?: string;
  // Where the public key that signs the repository is published.
  signingKey?: string;
  // What a deb repository is called to apt, and its components.
  suite?: string;
  components?: string[];
}

// The entry for one distribution, with every address resolved.
export interface ResolvedEntryPoint {
  read: string;
  write: string | null;
  signingKey: string | null;
  suite: string | null;
  components: string[] | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;

function parseEntry(value: unknown): ClientEntryPoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const plugin = nonEmptyString(value.plugin);
  const read = nonEmptyString(value.read);
  if (plugin === undefined || read === undefined) {
    return null;
  }

  const basePaths = stringList(value.basePaths);
  const basePathPrefix = nonEmptyString(value.basePathPrefix);
  const write = nonEmptyString(value.write);
  const signingKey = nonEmptyString(value.signingKey);
  const suite = nonEmptyString(value.suite);
  const components = stringList(value.components);

  return {
    plugin,
    ...(basePaths === undefined ? {} : { basePaths }),
    ...(basePathPrefix === undefined ? {} : { basePathPrefix }),
    read,
    ...(write === undefined ? {} : { write }),
    ...(signingKey === undefined ? {} : { signingKey }),
    ...(suite === undefined ? {} : { suite }),
    ...(components === undefined ? {} : { components }),
  };
}

// The deployment's entry points. A missing or malformed key means none, and an
// entry that is not an object or lacks its plugin or its read address is
// dropped, so a mistake in the configuration costs the snippets nothing but the
// entry point.
export function clientEntryPoints(): ClientEntryPoint[] {
  const entries = (config as { CLIENT_ENTRY_POINTS?: unknown } | null)
    ?.CLIENT_ENTRY_POINTS;

  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map(parseEntry)
    .filter((entry): entry is ClientEntryPoint => entry !== null);
}

// A base path as it is written into an address: each segment encoded, the
// slashes kept.
export const encodeBasePath = (basePath: string): string =>
  basePath.split('/').map(encodeURIComponent).join('/');

// An address made absolute against the origin. Only http and https addresses
// are used; anything else, such as a script address in a mistaken
// configuration, is refused.
function resolve(address: string, origin: string): string | null {
  try {
    const url = new URL(address, origin);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const matches = (entry: ClientEntryPoint, plugin: string, basePath: string) =>
  entry.plugin === plugin &&
  ((entry.basePaths?.includes(basePath) ?? false) ||
    (entry.basePathPrefix !== undefined &&
      basePath.startsWith(entry.basePathPrefix)));

// The first entry point of the deployment for a distribution of the plugin with
// this base path, its addresses filled in and resolved, or null when the
// deployment names none (or its read address is not usable): the snippets then
// use the address the server reports.
export function entryPointFor(
  plugin: string,
  basePath: string,
  origin: string = window.location.origin,
): ResolvedEntryPoint | null {
  const entry = clientEntryPoints().find((candidate) =>
    matches(candidate, plugin, basePath),
  );
  if (!entry) {
    return null;
  }

  const filled = (address: string) =>
    resolve(
      address.replaceAll('{base_path}', encodeBasePath(basePath)),
      origin,
    );
  const read = filled(entry.read);
  if (read === null) {
    return null;
  }

  return {
    read,
    write: entry.write === undefined ? null : filled(entry.write),
    signingKey:
      entry.signingKey === undefined ? null : filled(entry.signingKey),
    suite: entry.suite ?? null,
    components: entry.components ?? null,
  };
}
