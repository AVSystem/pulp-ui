import pulpVersions from '@pulp-ui/sdk/pulp-versions.json';
import { describe, expect, it } from 'vitest';
import { generatedVersions, versionDifferences } from './generated-versions';

describe('generated versions', () => {
  it('are the apps the typed client was generated against', () => {
    expect(generatedVersions).toEqual(pulpVersions.apps);
    expect(generatedVersions.core).toMatch(/^\d/);
  });
});

describe('version differences', () => {
  const generated = { core: '3.120.0', rpm: '3.39.0' };

  it('are empty when the server runs the generated versions', () => {
    expect(
      versionDifferences({ core: '3.120.0', rpm: '3.39.0' }, generated),
    ).toEqual([]);
  });

  it('name a plugin that runs another version with both versions', () => {
    expect(
      versionDifferences({ core: '3.120.0', rpm: '3.40.0' }, generated),
    ).toEqual([
      {
        name: 'rpm',
        kind: 'different',
        generated: '3.39.0',
        running: '3.40.0',
      },
    ]);
  });

  it('report a plugin the server runs that was not generated', () => {
    expect(
      versionDifferences(
        { core: '3.120.0', rpm: '3.39.0', container: '2.0.0' },
        generated,
      ),
    ).toEqual([{ name: 'container', kind: 'not-generated', running: '2.0.0' }]);
  });

  it('report a generated plugin the server does not run', () => {
    expect(versionDifferences({ core: '3.120.0' }, generated)).toEqual([
      { name: 'rpm', kind: 'not-installed', generated: '3.39.0' },
    ]);
  });

  it('are sorted by name whatever the kind', () => {
    const names = versionDifferences(
      { zeta: '1', core: '9', alpha: '1' },
      { core: '3', rpm: '3', beta: '1' },
    ).map(({ name }) => name);

    expect(names).toEqual(['alpha', 'beta', 'core', 'rpm', 'zeta']);
  });

  it('accept a map as the server versions, as the plugin list holds them', () => {
    const running = new Map([
      ['core', '3.120.0'],
      ['rpm', '3.40.0'],
    ]);

    expect(versionDifferences(running, generated)).toEqual([
      {
        name: 'rpm',
        kind: 'different',
        generated: '3.39.0',
        running: '3.40.0',
      },
    ]);
  });
});
