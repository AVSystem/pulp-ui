import { describe, expect, it } from 'vitest';
import { config } from 'src/ui-config';
import { taskHref, taskUrlId } from './href';

const ID = '0192e5a1-0000-7000-8000-000000000001';

describe('task address and id', { tags: ['unit'] }, () => {
  it('turns an id into the address of the task and back', () => {
    expect(taskHref(ID)).toBe(`${config.API_BASE_PATH}tasks/${ID}/`);
    expect(taskUrlId(taskHref(ID))).toBe(ID);
  });

  it('reads the id of an address with or without the trailing slash', () => {
    expect(taskUrlId(`/pulp/api/v3/tasks/${ID}/`)).toBe(ID);
    expect(taskUrlId(`/pulp/api/v3/tasks/${ID}`)).toBe(ID);
    expect(taskUrlId(`/pulp/default/api/v3/tasks/${ID}/`)).toBe(ID);
  });

  it('refuses text that is not an id', () => {
    expect(taskHref('not-a-uuid')).toBeNull();
    expect(taskHref('')).toBeNull();
    expect(taskHref(`${ID}/../../status`)).toBeNull();
    expect(taskHref(`${ID}?x=1`)).toBeNull();
    expect(taskHref(null)).toBeNull();
    expect(taskHref(undefined)).toBeNull();
  });

  it('refuses an address that is not the address of one task', () => {
    expect(taskUrlId(null)).toBeNull();
    expect(taskUrlId('')).toBeNull();
    expect(taskUrlId(`/pulp/api/v3/workers/${ID}/`)).toBeNull();
    expect(taskUrlId(`/pulp/api/v3/tasks/${ID}/cancel/`)).toBeNull();
    expect(taskUrlId('/pulp/api/v3/tasks/')).toBeNull();
  });
});
