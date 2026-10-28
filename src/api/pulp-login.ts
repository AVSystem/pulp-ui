import { basicAuthorization } from '../utilities/basic-authorization';
import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const PulpLoginAPI = {
  // The Basic header is built here because the client's own auth option
  // encodes Latin-1 only. A successful call starts a server session.
  login: (username: string, password: string) =>
    base.http.post('login/', null, {
      headers: { Authorization: basicAuthorization(username, password) },
    }),

  // Who is signed in; answers 401 when nobody is.
  whoami: () => base.http.get('login/'),

  // Ends the server session.
  logout: () => base.http.delete('login/'),
};
