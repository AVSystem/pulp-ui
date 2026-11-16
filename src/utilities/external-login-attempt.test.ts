import { afterEach, describe, expect, it } from 'vitest';
import {
  EXTERNAL_LOGIN_AT_KEY,
  externalLoginAge,
  forgetExternalLogin,
  rememberExternalLogin,
} from './external-login-attempt';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('externalLoginAge', () => {
  it('is null when no attempt was stored', () => {
    expect(externalLoginAge(10_000)).toBeNull();
  });

  it('is the time since the stored attempt', () => {
    rememberExternalLogin(4_000);

    expect(externalLoginAge(10_000)).toBe(6_000);
  });

  it('is zero for an attempt stored at the same instant', () => {
    rememberExternalLogin(10_000);

    expect(externalLoginAge(10_000)).toBe(0);
  });

  it('is null when the stored time is later than now, so it counts as no recent attempt', () => {
    rememberExternalLogin(20_000);

    expect(externalLoginAge(10_000)).toBeNull();
  });

  it('is null when the stored value is not a number', () => {
    window.sessionStorage.setItem(EXTERNAL_LOGIN_AT_KEY, 'soon');

    expect(externalLoginAge(10_000)).toBeNull();
  });

  it('is null once the attempt was forgotten', () => {
    rememberExternalLogin(4_000);
    forgetExternalLogin();

    expect(externalLoginAge(10_000)).toBeNull();
  });
});
