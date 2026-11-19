import { describe, expect, it } from 'vitest';
import { statusSchema } from './model';

describe('Unit: status model', { tags: ['unit'] }, () => {
  // What the server answers to someone who is not signed in: health only.
  const anonymous = {
    database_connection: { connected: true },
    redis_connection: { connected: true },
  };

  // A signed-in account that is not an administrator also gets the versions.
  const signedIn = {
    ...anonymous,
    versions: [
      { component: 'core', version: '3.112.0' },
      { component: 'file', version: '3.112.0' },
    ],
  };

  // The full answer of an administrator. The workers carry the address the
  // server gives them, which the generated type does not list.
  const administrator = {
    versions: [
      {
        component: 'core',
        version: '3.112.0',
        package: 'pulpcore',
        module: 'pulpcore.app',
        domain_compatible: true,
      },
    ],
    online_workers: [
      {
        pulp_href: '/pulp/api/v3/workers/1/',
        name: '1@worker',
        last_heartbeat: '2026-01-01T00:00:00Z',
        versions: { core: '3.112.0' },
      },
    ],
    online_api_apps: [
      { name: '1@api', last_heartbeat: '2026-01-01T00:00:00Z' },
    ],
    online_content_apps: [],
    database_connection: { connected: true },
    redis_connection: { connected: false },
    storage: { total: 100, used: 40, free: 60 },
    content_settings: {
      content_origin: null,
      content_path_prefix: '/pulp/content/',
    },
    domain_enabled: false,
  };

  it('reads the health-only answer a visitor gets', () => {
    const result = statusSchema.parse(anonymous);

    expect(result.database_connection?.connected).toBe(true);
    expect(result.redis_connection?.connected).toBe(true);
  });

  it('leaves a key out of the result when the answer leaves it out', () => {
    const result = statusSchema.parse(anonymous);

    // The status screen decides which cards to show by the keys of the answer.
    expect('versions' in result).toBe(false);
    expect('online_workers' in result).toBe(false);
    expect('storage' in result).toBe(false);
  });

  it('reads the versions a signed-in account gets', () => {
    const result = statusSchema.parse(signedIn);

    expect(result.versions).toStrictEqual(signedIn.versions);
    expect('online_workers' in result).toBe(false);
  });

  it('reads the full answer of an administrator', () => {
    expect(statusSchema.parse(administrator)).toStrictEqual(administrator);
  });

  it('accepts a relative pulp_href of a worker', () => {
    const result = statusSchema.parse(administrator);

    expect(result.online_workers?.[0]?.pulp_href).toBe(
      '/pulp/api/v3/workers/1/',
    );
  });

  it('accepts a storage answer that measures nothing', () => {
    const none = statusSchema.parse({
      ...signedIn,
      storage: { total: null, used: null, free: null },
    });
    const missing = statusSchema.parse({ ...signedIn, storage: null });

    expect(none.storage).toStrictEqual({
      total: null,
      used: null,
      free: null,
    });
    expect(missing.storage).toBeNull();
  });

  it('keeps fields it does not know, at the top and inside entries', () => {
    const result = statusSchema.parse({
      ...signedIn,
      later_field: { a: 1 },
      versions: [{ component: 'core', version: '1', extra: true }],
    });

    expect(result).toMatchObject({
      later_field: { a: 1 },
      versions: [{ component: 'core', version: '1', extra: true }],
    });
  });

  it('rejects a version entry without a component', () => {
    const result = statusSchema.safeParse({
      ...signedIn,
      versions: [{ version: '1' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects versions that are not a list', () => {
    expect(
      statusSchema.safeParse({ ...signedIn, versions: 'not-a-list' }).success,
    ).toBe(false);
  });

  it('rejects a connection answer without the connected flag', () => {
    expect(
      statusSchema.safeParse({ database_connection: { up: true } }).success,
    ).toBe(false);
  });
});
