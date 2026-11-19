import pulpVersions from '@pulp-ui/sdk/pulp-versions.json';

// The plugin versions the typed client was generated against, by app label.
export const generatedVersions: Readonly<Record<string, string>> =
  pulpVersions.apps;

export interface VersionDifference {
  name: string;
  // different: both sides have the plugin, at other versions; not-generated:
  // the server runs a plugin the client was not generated for; not-installed:
  // the client was generated for a plugin the server does not run
  kind: 'different' | 'not-generated' | 'not-installed';
  generated?: string;
  running?: string;
}

const entries = (
  versions: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): [string, string][] =>
  versions instanceof Map
    ? Array.from(versions.entries())
    : Object.entries(versions);

// Where the plugin versions a server runs differ from the ones the typed client
// was generated against, sorted by name. The list only informs: a difference
// never blocks anything, because the server's answers are read tolerantly.
export function versionDifferences(
  serverVersions:
    ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  generated: Readonly<Record<string, string>> = generatedVersions,
): VersionDifference[] {
  const running = new Map(entries(serverVersions));
  const names = new Set(
    Object.keys(generated).concat(Array.from(running.keys())),
  );
  const differences: VersionDifference[] = [];

  for (const name of Array.from(names).sort()) {
    const wanted = Object.prototype.hasOwnProperty.call(generated, name)
      ? generated[name]
      : undefined;
    const actual = running.get(name);

    if (wanted === undefined) {
      differences.push({ name, kind: 'not-generated', running: actual });
    } else if (actual === undefined) {
      differences.push({ name, kind: 'not-installed', generated: wanted });
    } else if (wanted !== actual) {
      differences.push({
        name,
        kind: 'different',
        generated: wanted,
        running: actual,
      });
    }
  }

  return differences;
}
