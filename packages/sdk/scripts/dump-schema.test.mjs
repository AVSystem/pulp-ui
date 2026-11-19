// @vitest-environment node
// Tests of the development schema dump: the docker arguments, the image
// source list and the refusal to run without an image. No test starts docker;
// the refusal test puts a stand-in docker first on the path and checks that it
// was never called.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addImageSources, buildDockerArgs } from './dump-schema.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'dump-schema.mjs');

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dump-schema-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Unit: docker arguments', { tags: ['unit'] }, () => {
  it('runs the image without a network and with a fixed hash seed', () => {
    expect(buildDockerArgs('example-image:1')).toEqual([
      'run',
      '--rm',
      '--network',
      'none',
      '-e',
      'PYTHONHASHSEED=0',
      'example-image:1',
      'pulpcore-manager',
      'openapi',
      '--format',
      'openapi-json',
    ]);
  });

  it('mounts nothing and publishes no port', () => {
    const args = buildDockerArgs('example-image:1');
    for (const forbidden of ['-v', '--volume', '--mount', '-p', '--publish']) {
      expect(args).not.toContain(forbidden);
    }
  });
});

describe('Unit: image sources', { tags: ['unit'] }, () => {
  it('copies the PULP_IMAGE_SOURCES line into the schema info', () => {
    const spec = { info: { title: 'Pulp 3 API' }, paths: {} };
    const result = addImageSources(spec, [
      'PATH=/usr/bin',
      'PULP_IMAGE_SOURCES=pulpcore@aaaa pulp_rpm@bbbb',
    ]);
    expect(result.info['x-pulp-image-sources']).toBe(
      'pulpcore@aaaa pulp_rpm@bbbb',
    );
    expect(result.info.title).toBe('Pulp 3 API');
  });

  it('sets an empty string when the image has no source list', () => {
    const result = addImageSources({ info: {} }, ['PATH=/usr/bin', '']);
    expect(result.info['x-pulp-image-sources']).toBe('');
  });

  it('keeps an equals sign inside the value', () => {
    const result = addImageSources({ info: {} }, ['PULP_IMAGE_SOURCES=a@b=c']);
    expect(result.info['x-pulp-image-sources']).toBe('a@b=c');
  });

  it('does not change the schema it was given', () => {
    const spec = { info: { title: 'x' } };
    addImageSources(spec, ['PULP_IMAGE_SOURCES=a@b']);
    expect(spec.info).toEqual({ title: 'x' });
  });
});

describe('Unit: the command', { tags: ['unit'] }, () => {
  it('refuses to run without PULP_SCHEMA_IMAGE and never calls docker', () => {
    const marker = join(dir, 'docker-called');
    const stub = join(dir, 'docker');
    writeFileSync(stub, `#!/bin/sh\ntouch '${marker}'\nexit 0\n`);
    chmodSync(stub, 0o755);
    const env = {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
    };
    delete env.PULP_SCHEMA_IMAGE;
    const result = spawnSync(
      process.execPath,
      [SCRIPT, join(dir, 'out.json')],
      {
        env,
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('PULP_SCHEMA_IMAGE is not set');
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(dir, 'out.json'))).toBe(false);
  });

  it('exits 2 with usage when no output file is given', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: { ...process.env, PULP_SCHEMA_IMAGE: 'example-image:1' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage');
  });
});
