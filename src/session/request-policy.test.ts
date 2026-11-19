import { afterEach, describe, expect, it } from 'vitest';
import { config } from 'src/ui-config';
import { isLoginUrl, resolveApiUrl } from './request-policy';

const defaultBase = config.API_BASE_PATH;

afterEach(() => {
  config.API_BASE_PATH = defaultBase;
});

describe('resolveApiUrl', () => {
  it('leaves a path under the configured base alone', () => {
    expect(resolveApiUrl('/pulp/api/v3/tasks/1/')).toBe(
      '/pulp/api/v3/tasks/1/',
    );
    expect(resolveApiUrl('/pulp/api/v3/status/?fields=a')).toBe(
      '/pulp/api/v3/status/?fields=a',
    );
  });

  it('collapses a leading double slash so the first path segment is never read as a host', () => {
    expect(resolveApiUrl('//pulp/api/v3/tasks/1/')).toBe(
      '/pulp/api/v3/tasks/1/',
    );
  });

  it('moves the schema root to the configured base', () => {
    config.API_BASE_PATH = '/other/api/';

    expect(resolveApiUrl('/pulp/api/v3/status/')).toBe('/other/api/status/');
    expect(resolveApiUrl('//pulp/api/v3/tasks/0001/')).toBe(
      '/other/api/tasks/0001/',
    );
  });

  it('leaves a path that already starts with the configured base alone', () => {
    config.API_BASE_PATH = '/other/api/';

    expect(resolveApiUrl('/other/api/tasks/0001/')).toBe(
      '/other/api/tasks/0001/',
    );
  });

  it.each([
    'https://evil.example/x',
    '//evil.example/pulp/api/v3/tasks/1/',
    '///pulp/api/v3/tasks/1/',
    '/elsewhere/',
    'pulp/api/v3/tasks/1/',
    '',
    '/pulp/api/v3/../../elsewhere/',
    '/pulp/api/v3/%2e%2e/%2e%2e/elsewhere/',
    '/pulp/api/v3',
  ])('refuses %j because it leaves the API', (url) => {
    expect(() => resolveApiUrl(url)).toThrow(/leaves the API/);
  });

  it('refuses the schema root once the base moved away from it', () => {
    config.API_BASE_PATH = '/other/api/';

    expect(() => resolveApiUrl('/pulp/elsewhere/')).toThrow(/leaves the API/);
  });
});

describe('isLoginUrl', () => {
  it.each([
    'login/',
    'login/?x=1',
    '/pulp/api/v3/login/',
    '//pulp/api/v3/login/',
  ])('recognises %j', (url) => {
    expect(isLoginUrl(url)).toBe(true);
  });

  it('recognises the login call under a moved base', () => {
    config.API_BASE_PATH = '/other/api/';

    expect(isLoginUrl('/other/api/login/')).toBe(true);
    expect(isLoginUrl('/pulp/api/v3/login/')).toBe(true);
  });

  it.each([
    'logins/',
    'tasks/login/',
    '/pulp/api/v3/tasks/',
    '/pulp/api/v3/status/',
    '',
  ])('does not recognise %j', (url) => {
    expect(isLoginUrl(url)).toBe(false);
  });
});
