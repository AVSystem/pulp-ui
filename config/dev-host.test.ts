// @vitest-environment node
// The dev server must not listen on every interface while it relays requests
// to a target that is not on this machine. DEV_HOST stays the explicit
// override.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { devHost, isLocalTarget } = require('./dev-host.js');

describe('the dev server bind address', () => {
  it('keeps the default when no proxy target is set', () => {
    expect(devHost({})).toBeUndefined();
  });

  it.each([
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://127.1.2.3',
    'http://[::1]:8080',
    'http://pulp.localhost',
  ])('keeps the default for the local target %s', (target) => {
    expect(devHost({ API_PROXY: target })).toBeUndefined();
  });

  it.each([
    'https://pulp.example.org',
    'http://pulp.example.test:8080',
    'http://pulp.localhost.example.org',
    'not a url',
  ])('binds to loopback for the target %s', (target) => {
    expect(devHost({ API_PROXY: target })).toBe('127.0.0.1');
  });

  it('lets DEV_HOST override in both directions', () => {
    expect(
      devHost({ API_PROXY: 'https://pulp.example.org', DEV_HOST: '0.0.0.0' }),
    ).toBe('0.0.0.0');
    expect(
      devHost({ API_PROXY: 'http://localhost:8080', DEV_HOST: '127.0.0.1' }),
    ).toBe('127.0.0.1');
  });

  it('treats only this machine as local', () => {
    expect(isLocalTarget('http://localhost')).toBe(true);
    expect(isLocalTarget('https://example.org')).toBe(false);
  });
});
