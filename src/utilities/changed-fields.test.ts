import { describe, expect, it } from 'vitest';
import { changedFields } from './changed-fields';

describe('changedFields', () => {
  it('returns only the fields whose value differs', () => {
    expect(
      changedFields(
        { name: 'a', description: 'x', pulp_labels: { k: 'v' } },
        { name: 'a', description: 'y', pulp_labels: { k: 'v' } },
      ),
    ).toStrictEqual({ description: 'y' });
  });

  it('returns nothing when every field is the same', () => {
    expect(
      changedFields(
        { name: 'a', retain_repo_versions: null, autopublish: false },
        { name: 'a', retain_repo_versions: null, autopublish: false },
      ),
    ).toStrictEqual({});
  });

  it('compares labels by content, whatever the key order', () => {
    expect(
      changedFields(
        { pulp_labels: { a: '1', b: '2' } },
        { pulp_labels: { b: '2', a: '1' } },
      ),
    ).toStrictEqual({});
  });

  it('returns the whole labels object when one label changed', () => {
    expect(
      changedFields(
        { pulp_labels: { a: '1', b: '2' } },
        { pulp_labels: { a: '1', b: '3' } },
      ),
    ).toStrictEqual({ pulp_labels: { a: '1', b: '3' } });
  });

  it('treats no labels at all and an empty labels object as the same', () => {
    expect(changedFields({}, { pulp_labels: {} })).toStrictEqual({});
    expect(
      changedFields({ pulp_labels: null }, { pulp_labels: {} }),
    ).toStrictEqual({});
  });

  it('returns an empty labels object when the last label was removed', () => {
    expect(
      changedFields({ pulp_labels: { a: '1' } }, { pulp_labels: {} }),
    ).toStrictEqual({ pulp_labels: {} });
  });

  it('returns the labels object when a label was removed', () => {
    expect(
      changedFields(
        { pulp_labels: { a: '1', b: '2' } },
        { pulp_labels: { a: '1' } },
      ),
    ).toStrictEqual({ pulp_labels: { a: '1' } });
  });

  it('treats an empty string for a field that was null as unchanged', () => {
    expect(
      changedFields({ description: null }, { description: '' }),
    ).toStrictEqual({});
  });

  it('sends null for a field that had a value and was emptied', () => {
    expect(
      changedFields(
        { description: 'x', retain_repo_versions: 3 },
        { description: '', retain_repo_versions: '' },
      ),
    ).toStrictEqual({ description: null, retain_repo_versions: null });
  });

  it('treats a number and the same number typed into a field as the same value', () => {
    expect(
      changedFields({ retain_repo_versions: 3 }, { retain_repo_versions: '3' }),
    ).toStrictEqual({});
    expect(
      changedFields({ retain_repo_versions: 3 }, { retain_repo_versions: '4' }),
    ).toStrictEqual({ retain_repo_versions: '4' });
  });

  it('treats a field the original lacks like a null one', () => {
    expect(changedFields({}, { remote: null })).toStrictEqual({});
    expect(changedFields({}, { remote: '/r/1/' })).toStrictEqual({
      remote: '/r/1/',
    });
  });

  it('returns a cleared remote as null', () => {
    expect(changedFields({ remote: '/r/1/' }, { remote: null })).toStrictEqual({
      remote: null,
    });
  });

  it('keeps a changed boolean, including a change to false', () => {
    expect(
      changedFields({ autopublish: true }, { autopublish: false }),
    ).toStrictEqual({ autopublish: false });
  });

  it('ignores a field of the original that the edited copy does not carry', () => {
    expect(changedFields({ a: 1, b: 2 }, { a: 1 })).toStrictEqual({});
  });
});
