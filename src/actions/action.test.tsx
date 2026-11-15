import { msg } from '@lingui/core/macro';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Action } from './action';

const ITEM = { pulp_href: '/pulp/api/v3/things/1/', name: 'alpha' };

// A context in which the user holds the named permissions globally and, per
// object address, the permissions of that object.
const context = ({
  global = [],
  object = {},
}: {
  global?: string[];
  object?: Record<string, string[]>;
} = {}) => {
  const hasPermission = vi.fn((name: string) => global.includes(name));
  const hasObjectPermission = vi.fn(
    (name: string, item?: { pulp_href?: string }) =>
      global.includes(name) || !!object[item?.pulp_href ?? '']?.includes(name),
  );
  return { hasPermission, hasObjectPermission };
};

const shownButton = (node: ReactNode) => {
  render(<>{node}</>);
  return screen.queryByRole('button', { name: 'Change' });
};

describe('an action with a permission', () => {
  const change = Action({
    title: msg`Change`,
    permission: 'file.change_filerepository',
    onClick: () => undefined,
  });

  it('is shown to a global holder', () => {
    const ctx = context({ global: ['file.change_filerepository'] });

    expect(change.isShown(ITEM, ctx)).toBe(true);
    expect(shownButton(change.button(ITEM, ctx))).toBeInTheDocument();
  });

  it('is shown for an object whose permissions list it', () => {
    const ctx = context({
      object: { [ITEM.pulp_href]: ['file.change_filerepository'] },
    });

    expect(change.isShown(ITEM, ctx)).toBe(true);
    expect(ctx.hasObjectPermission).toHaveBeenCalledWith(
      'file.change_filerepository',
      ITEM,
    );
  });

  it('is absent, not disabled, for a user who holds the permission nowhere', () => {
    const ctx = context({ object: { [ITEM.pulp_href]: ['file.view_x'] } });

    expect(change.isShown(ITEM, ctx)).toBe(false);
    expect(change.button(ITEM, ctx)).toBeNull();
    expect(change.dropdownItem(ITEM, ctx)).toBeNull();
  });

  it('is decided by the global permission alone without an item', () => {
    const none = context({
      object: { [ITEM.pulp_href]: ['file.change_filerepository'] },
    });
    expect(change.isShown(null, none)).toBe(false);
    expect(none.hasObjectPermission).not.toHaveBeenCalled();

    const global = context({ global: ['file.change_filerepository'] });
    expect(change.isShown(null, global)).toBe(true);
  });

  it('is decided by the global permission alone when it is not an object level action', () => {
    const create = Action({
      title: msg`Change`,
      permission: 'file.add_filerepository',
      objectLevel: false,
      onClick: () => undefined,
    });
    const ctx = context({
      object: { [ITEM.pulp_href]: ['file.add_filerepository'] },
    });

    expect(create.isShown(ITEM, ctx)).toBe(false);
    expect(ctx.hasObjectPermission).not.toHaveBeenCalled();
    expect(
      create.isShown(ITEM, context({ global: ['file.add_filerepository'] })),
    ).toBe(true);
  });

  it('needs the explicit visible function to agree as well', () => {
    const picky = Action({
      title: msg`Change`,
      permission: 'file.change_filerepository',
      visible: (item) => item?.name === 'beta',
      onClick: () => undefined,
    });
    const ctx = context({ global: ['file.change_filerepository'] });

    expect(picky.isShown(ITEM, ctx)).toBe(false);
    expect(picky.isShown({ ...ITEM, name: 'beta' }, ctx)).toBe(true);
    expect(
      picky.isShown(
        { ...ITEM, name: 'beta' },
        context({ global: ['file.view_x'] }),
      ),
    ).toBe(false);
  });

  it('keeps an explicit visible function working without a permission', () => {
    const plain = Action({
      title: msg`Change`,
      visible: () => false,
      onClick: () => undefined,
    });

    expect(plain.isShown(ITEM, context())).toBe(false);
    expect(
      Action({ title: msg`Change`, onClick: () => undefined }).isShown(
        ITEM,
        context(),
      ),
    ).toBe(true);
  });

  it('is absent when its condition does not hold', () => {
    const conditional = Action({
      title: msg`Change`,
      permission: 'file.change_filerepository',
      condition: () => false,
      onClick: () => undefined,
    });
    const ctx = context({ global: ['file.change_filerepository'] });

    expect(conditional.isShown(ITEM, ctx)).toBe(false);
    expect(conditional.button(ITEM, ctx)).toBeNull();
  });

  it('exposes the permission and the object level it was declared with', () => {
    expect(change.permission).toBe('file.change_filerepository');
    expect(change.objectLevel).toBe(true);
    expect(
      Action({
        title: msg`Change`,
        permission: 'x.y',
        objectLevel: false,
        onClick: () => undefined,
      }).objectLevel,
    ).toBe(false);
  });
});
