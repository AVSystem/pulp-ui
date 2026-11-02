import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { config } from 'src/ui-config';
import { LoginLink } from './login-link';

const EXTERNAL_LOGIN = 'https://login.example/start';

afterEach(() => {
  config.UI_EXTERNAL_LOGIN_URI = null;
});

describe('login link', () => {
  it('carries the path and its query string unchanged as the return target', () => {
    renderWithProviders(<LoginLink />, {
      route: '/deb/repositories?name=%C5%BC',
    });

    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute(
      'href',
      `/login/?next=${encodeURIComponent('/deb/repositories?name=%C5%BC')}`,
    );
  });

  it('carries the bare path when the page has no query string', () => {
    renderWithProviders(<LoginLink />, { route: '/deb/repositories' });

    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute(
      'href',
      `/login/?next=${encodeURIComponent('/deb/repositories')}`,
    );
  });

  it('keeps an encoded ampersand inside a query value', () => {
    renderWithProviders(<LoginLink />, {
      route: '/deb/repositories?q=a%26b&page=2',
    });

    const href = screen
      .getByRole('link', { name: 'Login' })
      .getAttribute('href');
    const next = new URL(href ?? '', 'https://ui.example').searchParams.get(
      'next',
    );
    expect(next).toBe('/deb/repositories?q=a%26b&page=2');
  });

  it('passes the path with its query to the external login address', () => {
    config.UI_EXTERNAL_LOGIN_URI = EXTERNAL_LOGIN;

    renderWithProviders(<LoginLink />, {
      route: '/deb/repositories?name=%C5%BC&q=a//b',
    });

    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute(
      'href',
      `${EXTERNAL_LOGIN}?next=${encodeURIComponent('/ui/deb/repositories?name=%C5%BC&q=a//b')}`,
    );
  });
});
