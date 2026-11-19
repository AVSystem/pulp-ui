import { describe, expect, it } from 'vitest';
import { emptyUserForm, userChanges, userCreateBody, userToForm } from './form';

const ann = userToForm({
  pulp_href: '/pulp/api/v3/users/4/',
  id: 4,
  username: 'zz-ann',
  first_name: null,
  email: 'ann@example.com',
  groups: [{ id: 3, name: 'zz-group', pulp_href: '/pulp/api/v3/groups/3/' }],
});

describe('the user form values', () => {
  it('turn what the server left out into empty texts and keep the groups by id and name', () => {
    expect(ann).toEqual({
      id: 4,
      pulp_href: '/pulp/api/v3/users/4/',
      username: 'zz-ann',
      first_name: '',
      last_name: '',
      email: 'ann@example.com',
      password: '',
      groups: [{ id: 3, name: 'zz-group' }],
    });
  });

  it('send only the changed text fields, an emptied one as an empty text', () => {
    expect(userChanges(ann, { ...ann })).toEqual({});
    expect(userChanges(ann, { ...ann, first_name: 'Anna', email: '' })).toEqual(
      { first_name: 'Anna', email: '' },
    );
  });

  it('send a password only when one was typed, and never the groups', () => {
    expect(userChanges(ann, { ...ann, password: '' })).toEqual({});
    expect(
      userChanges(ann, { ...ann, password: 'N3w!passw0rd', groups: [] }),
    ).toEqual({ password: 'N3w!passw0rd' });
  });

  it('send the fields of a new user without its groups', () => {
    expect(
      userCreateBody({ ...emptyUserForm(), username: 'zz-new', password: 'x' }),
    ).toEqual({
      username: 'zz-new',
      first_name: '',
      last_name: '',
      email: '',
      password: 'x',
    });
  });
});
