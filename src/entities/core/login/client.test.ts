import type { LoginResponse } from '@pulp-ui/sdk/core/models/login/login-response.zod';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError } from 'src/entities/response-shape';
import { server } from 'src/test-utils/server';
import { LoginClient } from './client';

describe('Integration: LoginClient', { tags: ['integration'] }, () => {
  const loginResponseBody = {
    pulp_href: '/pulp/api/v3/users/4/',
    prn: 'prn:auth.user:4',
    username: 'admin',
  } satisfies LoginResponse;

  const basic = (user: string, pass: string): string =>
    `Basic ${Buffer.from(`${user}:${pass}`, 'utf-8').toString('base64')}`;

  it('retrieve decodes the current session user', async () => {
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json(loginResponseBody),
      ),
    );

    await expect(LoginClient.retrieve()).resolves.toStrictEqual({
      href: loginResponseBody.pulp_href,
      prn: loginResponseBody.prn,
      username: loginResponseBody.username,
    });
  });

  it('login sends the credentials as a UTF-8 Basic Auth header', async () => {
    let authorization: string | null = null;
    server.use(
      http.post('*/pulp/api/v3/login/', ({ request }) => {
        authorization = request.headers.get('authorization');
        return HttpResponse.json(loginResponseBody, { status: 201 });
      }),
    );

    await LoginClient.login({ username: 'admin', password: 'password' });

    expect(authorization).toStrictEqual(basic('admin', 'password'));
  });

  it('login rejects with the status on invalid credentials', async () => {
    server.use(
      http.post('*/pulp/api/v3/login/', () =>
        HttpResponse.json(
          { detail: 'Invalid username/password' },
          { status: 401 },
        ),
      ),
    );

    await expect(
      LoginClient.login({ username: 'admin', password: 'wrong' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('login rejects when a 201 response is missing a required field', async () => {
    server.use(
      http.post('*/pulp/api/v3/login/', () =>
        HttpResponse.json(
          {
            pulp_href: loginResponseBody.pulp_href,
            username: loginResponseBody.username,
          },
          { status: 201 },
        ),
      ),
    );

    await expect(
      LoginClient.login({ username: 'admin', password: 'password' }),
    ).rejects.toThrow(ResponseShapeError);
  });

  it('retrieve rejects an absolute pulp_href without echoing it', async () => {
    const href = 'https://other.example/pulp/api/v3/users/4/';
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ ...loginResponseBody, pulp_href: href }),
      ),
    );

    const failure = await LoginClient.retrieve().catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ResponseShapeError);
    expect(failure).toMatchObject({ path: 'pulp_href' });
    expect((failure as Error).message).not.toContain('other.example');
  });
});
