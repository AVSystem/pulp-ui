import { describe, expect, it } from 'vitest';
import { basicAuthorization } from './basic-authorization';

describe('basicAuthorization', () => {
  it('encodes ASCII credentials', () => {
    expect(basicAuthorization('admin', 'password')).toBe(
      'Basic YWRtaW46cGFzc3dvcmQ=',
    );
  });

  it('encodes empty credentials as a bare colon', () => {
    expect(basicAuthorization('', '')).toBe('Basic Og==');
  });

  it('encodes non-Latin-1 names and passwords as UTF-8 without throwing', () => {
    const username = '\u017c\u00f3\u0142w';
    const password = 'p\u0105ss:word';
    const expected = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

    expect(() => basicAuthorization(username, password)).not.toThrow();
    expect(basicAuthorization(username, password)).toBe(expected);
  });
});
