// @vitest-environment node
// Tests of the schema preparation: which application owns a path, what stops
// generation, and what the prepared schema no longer carries.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APPS,
  EXCLUDED_PATHS,
  classifyPath,
  mergeSpecs,
  prepareSpec,
} from './prepare-spec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const get = (operationId, extra = {}) => ({
  get: { operationId, responses: { 200: { description: 'ok' } }, ...extra },
});

/** A schema with one path per application and shared components. */
function fixture() {
  return {
    openapi: '3.0.1',
    info: { title: 'Fixture', version: 'v3' },
    servers: [{ url: 'http://pulp.example.com/' }],
    paths: {
      '/pulp/api/v3/status/': get('status_read', {
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Status' },
              },
            },
          },
        },
      }),
      '/pulp/api/v3/repositories/rpm/rpm/': get('repositories_rpm_rpm_list'),
      '{rpm_rpm_repository_href}': get('repositories_rpm_rpm_read', {
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Repo' },
              },
            },
          },
        },
      }),
    },
    components: {
      schemas: {
        Status: {
          type: 'object',
          properties: { next: { type: 'string', format: 'uri' } },
        },
        Repo: {
          type: 'object',
          properties: {
            pulp_href: { type: 'string', format: 'uri' },
            owner: { $ref: '#/components/schemas/Owner' },
          },
        },
        Owner: { type: 'object', properties: { name: { type: 'string' } } },
        Unused: { type: 'object' },
      },
      securitySchemes: { basicAuth: { type: 'http', scheme: 'basic' } },
    },
  };
}

describe('Unit: classifyPath', { tags: ['unit'] }, () => {
  it.each([
    ['/pulp/api/v3/repositories/rpm/rpm/', 'rpm'],
    ['/pulp/api/v3/rpm/copy/', 'rpm'],
    ['/pulp/api/v3/rpm/comps/', 'rpm'],
    ['/pulp/api/v3/deb/copy/', 'deb'],
    ['/pulp/api/v3/acs/deb/deb/', 'deb'],
    ['/pulp/api/v3/content/ansible/roles/', 'ansible'],
    ['/pulp/api/v3/ansible/collections/', 'ansible'],
    ['/pulp/api/v3/pulp_ansible/tags/', 'ansible'],
    ['/pulp/api/v3/pulp_container/namespaces/', 'container'],
    ['/pulp/api/v3/distributions/container/container/', 'container'],
    ['/pulp/api/v3/repositories/container/container-push/', 'container'],
    ['{container_container_distribution_href}set_label/', 'container'],
    ['{container_container_namespace_href}', 'container'],
    ['/pulp/api/v3/contentguards/certguard/x509/', 'certguard'],
    ['/pulp/api/v3/remotes/file/file/', 'file'],
    ['/pulp/api/v3/distributions/maven/maven/', 'maven'],
    ['/pulp/api/v3/publications/python/pypi/', 'python'],
    ['/pulp/api/v3/repositories/npm/npm/', 'npm'],
    ['/pulp/api/v3/tasks/', 'core'],
    ['/pulp/api/v3/status/', 'core'],
    ['/pulp/api/v3/content/', 'core'],
    ['/pulp/api/v3/repositories/reclaim_space/', 'core'],
    ['/pulp/api/v3/contentguards/core/rbac/', 'core'],
    ['/pulp/api/v3/exporters/core/filesystem/', 'core'],
    ['{rpm_rpm_repository_href}', 'rpm'],
    ['{rpm_rpm_repository_href}sync/', 'rpm'],
    ['{file_file_repository_href}modify/', 'file'],
    ['{ansible_ansible_repository_href}sign/', 'ansible'],
    [
      '{ansible_cross_repository_collection_version_index_href}api/v3/plugin/ansible/search/collection-versions/',
      'ansible',
    ],
    ['{python_package_yank_href}', 'python'],
    ['{certguard_x509_cert_guard_href}', 'certguard'],
    ['{task_href}', 'core'],
    ['{task_href}profile_artifacts/', 'core'],
    ['{filesystem_exporter_href}exports/', 'core'],
    ['{open_p_g_p_keyring_href}modify/', 'core'],
    ['{composite_content_guard_href}add_role/', 'core'],
    ['/pulp_ansible/galaxy/default/api/v3/collections/', 'ansible'],
    ['/pulp_ansible/galaxy/{path}/api/v3/namespaces/{name}/', 'ansible'],
    ['/ansible/collections/', 'ansible'],
    ['/pypi/{path}/simple/', 'python'],
    ['/npm/{path}/{package_name}', 'npm'],
  ])('maps %s to %s', (path, app) => {
    expect(classifyPath(path)).toBe(app);
  });

  it('claims nothing it does not know', () => {
    expect(classifyPath('/somewhere/else/')).toBeNull();
    expect(classifyPath('/pulp/other/')).toBeNull();
  });
});

describe('Unit: prepareSpec', { tags: ['unit'] }, () => {
  it('keeps the paths of one application and the components they reach', () => {
    const rpm = prepareSpec([fixture()], 'rpm');

    expect(Object.keys(rpm.paths).sort()).toStrictEqual([
      '/pulp/api/v3/repositories/rpm/rpm/',
      '{rpm_rpm_repository_href}',
    ]);
    expect(Object.keys(rpm.components.schemas).sort()).toStrictEqual([
      'Owner',
      'Repo',
    ]);
    expect(rpm.components.securitySchemes).toStrictEqual({
      basicAuth: { type: 'http', scheme: 'basic' },
    });
  });

  it('drops format uri everywhere and the servers entry', () => {
    const core = prepareSpec([fixture()], 'core');
    const rpm = prepareSpec([fixture()], 'rpm');

    expect(JSON.stringify(core)).not.toContain('"uri"');
    expect(JSON.stringify(rpm)).not.toContain('"uri"');
    expect(core.servers).toBeUndefined();
    expect(rpm.components.schemas.Repo.properties.pulp_href).toStrictEqual({
      type: 'string',
    });
  });

  it('keeps a property that is itself named format', () => {
    const spec = fixture();
    spec.components.schemas.Status.properties.format = {
      type: 'string',
      enum: ['uri'],
    };

    const core = prepareSpec([spec], 'core');

    expect(core.components.schemas.Status.properties.format).toStrictEqual({
      type: 'string',
      enum: ['uri'],
    });
  });

  it('does not change the schema it was given', () => {
    const spec = fixture();
    const before = JSON.stringify(spec);

    prepareSpec([spec], 'rpm');

    expect(JSON.stringify(spec)).toBe(before);
  });

  it('accepts one schema as well as a list', () => {
    expect(prepareSpec(fixture(), 'core')).toStrictEqual(
      prepareSpec([fixture()], 'core'),
    );
  });

  it('refuses an application it does not know', () => {
    expect(() => prepareSpec([fixture()], 'nonsense')).toThrow(/nonsense/);
  });

  it('stops, naming the paths, when no application claims a path', () => {
    const spec = fixture();
    spec.paths['/somewhere/else/'] = get('else_list');
    spec.paths['/also/unknown/'] = get('unknown_list');

    expect(() => prepareSpec([spec], 'core')).toThrow(
      /\/somewhere\/else\/[\s\S]*\/also\/unknown\//,
    );
    // The check covers the whole schema, not only the application asked for.
    expect(() => prepareSpec([spec], 'rpm')).toThrow(/\/somewhere\/else\//);
  });

  it('skips a path of the exclusion list without claiming it', () => {
    const spec = fixture();
    spec.paths['/pulp/api/v3/docs/api.json'] = get('docs_api_get');

    const core = prepareSpec([spec], 'core');

    expect(Object.keys(core.paths)).not.toContain('/pulp/api/v3/docs/api.json');
  });

  it('keeps only multipart for a body that carries a file', () => {
    const spec = fixture();
    const body = (schema) => ({
      required: true,
      content: {
        'application/json': { schema },
        'application/x-www-form-urlencoded': { schema },
        'multipart/form-data': { schema },
      },
    });
    spec.components.schemas.Upload = {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    };
    spec.components.schemas.Plain = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };
    spec.paths['/pulp/api/v3/uploads/'] = {
      post: {
        operationId: 'uploads_create',
        requestBody: body({ $ref: '#/components/schemas/Upload' }),
        responses: { 201: { description: 'ok' } },
      },
    };
    spec.paths['/pulp/api/v3/groups/'] = {
      post: {
        operationId: 'groups_create',
        requestBody: body({ $ref: '#/components/schemas/Plain' }),
        responses: { 201: { description: 'ok' } },
      },
    };

    const core = prepareSpec([spec], 'core');

    expect(
      Object.keys(core.paths['/pulp/api/v3/uploads/'].post.requestBody.content),
    ).toStrictEqual(['multipart/form-data']);
    expect(
      Object.keys(core.paths['/pulp/api/v3/groups/'].post.requestBody.content),
    ).toStrictEqual([
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
    ]);
  });
});

describe('Unit: mergeSpecs', { tags: ['unit'] }, () => {
  it('unites paths and components of every source', () => {
    const other = {
      openapi: '3.0.1',
      info: { title: 'Other', version: 'v3' },
      paths: {
        '/pulp/api/v3/repositories/container/container/': get('c_list'),
      },
      components: { schemas: { Image: { type: 'object' } } },
    };

    const merged = mergeSpecs([fixture(), other]);

    expect(Object.keys(merged.paths)).toContain(
      '/pulp/api/v3/repositories/container/container/',
    );
    expect(Object.keys(merged.paths)).toContain('/pulp/api/v3/status/');
    expect(Object.keys(merged.components.schemas)).toContain('Image');
    expect(Object.keys(merged.components.schemas)).toContain('Repo');
    expect(merged.info.title).toBe('Fixture');
  });

  it('accepts a component that two sources define identically, whatever the key order', () => {
    const other = {
      openapi: '3.0.1',
      info: { title: 'Other', version: 'v3' },
      paths: {},
      components: {
        schemas: {
          Owner: { properties: { name: { type: 'string' } }, type: 'object' },
        },
      },
    };

    const merged = mergeSpecs([fixture(), other]);

    expect(merged.components.schemas.Owner).toStrictEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
    });
  });

  it('stops, naming the component, when two sources define it differently', () => {
    const other = {
      openapi: '3.0.1',
      info: { title: 'Other', version: 'v3' },
      paths: {},
      components: {
        schemas: {
          Owner: { type: 'object', properties: { id: { type: 'integer' } } },
        },
      },
    };

    expect(() => mergeSpecs([fixture(), other])).toThrow(/Owner/);
  });

  it('stops, naming the path, when two sources define it differently', () => {
    const other = {
      openapi: '3.0.1',
      info: { title: 'Other', version: 'v3' },
      paths: { '/pulp/api/v3/status/': get('other_status') },
      components: {},
    };

    expect(() => mergeSpecs([fixture(), other])).toThrow(
      /\/pulp\/api\/v3\/status\//,
    );
  });

  it('works through prepareSpec for every source', () => {
    const other = {
      openapi: '3.0.1',
      info: { title: 'Other', version: 'v3' },
      paths: {},
      components: {
        schemas: { Owner: { type: 'object', properties: {} } },
      },
    };

    expect(() => prepareSpec([fixture(), other], 'rpm')).toThrow(/Owner/);
  });
});

describe('Unit: the exclusion list', { tags: ['unit'] }, () => {
  it('gives every excluded path a one-line reason', () => {
    expect(EXCLUDED_PATHS.length).toBeGreaterThan(0);
    for (const { path, reason } of EXCLUDED_PATHS) {
      expect(path).toMatch(/^\//);
      expect(reason).toMatch(/^[^\n]{8,}$/);
    }
  });

  it('is printed in full in the package readme', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

    for (const { path, reason } of EXCLUDED_PATHS) {
      expect(readme).toContain(path);
      expect(readme).toContain(reason);
    }
  });
});

describe('Unit: the committed schema', { tags: ['unit'] }, () => {
  const spec = JSON.parse(
    readFileSync(join(ROOT, 'schema', 'pulp.json'), 'utf8'),
  );
  const excluded = new Set(EXCLUDED_PATHS.map(({ path }) => path));

  it('has every path claimed by an application or excluded by name', () => {
    const unclaimed = Object.keys(spec.paths).filter(
      (path) => !excluded.has(path) && classifyPath(path) === null,
    );

    expect(unclaimed).toStrictEqual([]);
  });

  it('names only paths that exist in the schema in the exclusion list', () => {
    const missing = [...excluded].filter((path) => !(path in spec.paths));

    expect(missing).toStrictEqual([]);
  });

  it('puts every path into exactly one application', () => {
    const counts = Object.fromEntries(APPS.map((app) => [app, 0]));
    for (const path of Object.keys(spec.paths)) {
      if (!excluded.has(path)) {
        counts[classifyPath(path)] += 1;
      }
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

    expect(total).toBe(Object.keys(spec.paths).length - excluded.size);
    for (const app of APPS) {
      expect(counts[app], app).toBeGreaterThan(0);
    }
  });

  it('carries no format uri after preparation, for any application', () => {
    for (const app of APPS) {
      expect(JSON.stringify(prepareSpec([spec], app)), app).not.toContain(
        '"format":"uri"',
      );
    }
  });
});
