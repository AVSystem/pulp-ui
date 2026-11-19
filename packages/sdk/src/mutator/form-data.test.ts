import { describe, expect, it } from 'vitest';
import { pulpFormData } from './form-data';

describe('Unit: pulpFormData', { tags: ['unit'] }, () => {
  it('sends text fields as text and leaves out undefined and null', () => {
    const form = pulpFormData({
      name: 'repo',
      retain: 3,
      autopublish: false,
      description: null,
      remote: undefined,
    });

    expect(Object.fromEntries(form.entries())).toStrictEqual({
      name: 'repo',
      retain: '3',
      autopublish: 'false',
    });
  });

  it('sends a Blob and a File as they are', () => {
    const file = new File(['content'], 'a.txt', { type: 'text/plain' });
    const blob = new Blob(['bytes']);

    const form = pulpFormData({ file, other: blob });

    const sentFile = form.get('file');
    expect(sentFile).toBeInstanceOf(File);
    expect((sentFile as File).name).toBe('a.txt');
    expect(form.get('other')).toBeInstanceOf(Blob);
  });

  it('sends an object-valued field as JSON text', () => {
    const form = pulpFormData({ headers: [{ name: 'a' }], meta: { k: 1 } });

    expect(form.getAll('headers')).toStrictEqual(['{"name":"a"}']);
    expect(form.get('meta')).toBe('{"k":1}');
  });

  it('sends a list of text values as repeated fields', () => {
    const form = pulpFormData({ labels: ['a', 'b'] });

    expect(form.getAll('labels')).toStrictEqual(['a', 'b']);
  });
});
