import { loginRead, login as postLogin } from '@pulp-ui/sdk/core/login';
import { parseResponse } from 'src/entities/response-shape';
import {
  type Credentials,
  type Login,
  credentialsCodec,
  loginResponseCodec,
} from './model';

async function retrieve(): Promise<Login> {
  return parseResponse(loginResponseCodec, await loginRead());
}

async function login(credentials: Credentials): Promise<Login> {
  const authorisation = credentialsCodec.encode(credentials);
  return parseResponse(
    loginResponseCodec,
    await postLogin({ headers: { Authorization: authorisation } }),
  );
}

export const LoginClient = { retrieve, login };
