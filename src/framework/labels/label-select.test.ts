import { describe, expect, it } from 'vitest';
import {
  LABEL_KEY_PATTERN,
  labelKeyProblem,
  labelValueProblem,
} from './label-rules';
import {
  joinTerms,
  labelKeysOf,
  labelSelect,
  parseLabelSelect,
  splitTerms,
} from './label-select';

describe('Unit: the label select expression', { tags: ['unit'] }, () => {
  it('writes key and value rows, a key alone and an absent key as one expression', () => {
    expect(
      labelSelect([
        { key: 'tier', value: 'alpha' },
        { key: 'note', value: 'a,b' },
        { key: 'team' },
        { key: 'old', absent: true },
      ]),
    ).toBe('tier=alpha,note=a\\,b,team,!old');
  });

  it('writes a comma of a value escaped and nothing else of it', () => {
    expect(labelSelect([{ key: 'list', value: 'a,b,c' }])).toBe(
      'list=a\\,b\\,c',
    );
    expect(labelSelect([{ key: 'eq', value: 'x=y' }])).toBe('eq=x=y');
  });

  it('writes keys with a dot and a hyphen and with a space unchanged', () => {
    expect(
      labelSelect([
        { key: 'app.kubernetes.io-name', value: 'web' },
        { key: 'my key' },
      ]),
    ).toBe('app.kubernetes.io-name=web,my key');
  });

  it('leaves out a row with no key and writes nothing for no rows', () => {
    expect(labelSelect([{ key: '' }, { key: '  ', value: 'x' }])).toBe('');
    expect(labelSelect([])).toBe('');
  });

  it('writes a value that is the empty text as a pair and a missing value as the key alone', () => {
    expect(labelSelect([{ key: 'a', value: '' }])).toBe('a=');
    expect(labelSelect([{ key: 'a', value: null }])).toBe('a');
    expect(labelSelect([{ key: 'a', value: undefined }])).toBe('a');
  });

  it('writes an absent key without its value', () => {
    expect(labelSelect([{ key: 'old', value: 'x', absent: true }])).toBe(
      '!old',
    );
  });

  it('reads key=value, key and !key terms back into rows', () => {
    expect(parseLabelSelect('tier=alpha,note=a\\,b,team,!old')).toEqual([
      { key: 'tier', value: 'alpha' },
      { key: 'note', value: 'a,b' },
      { key: 'team' },
      { key: 'old', absent: true },
    ]);
  });

  it('reads an expression it wrote into the rows it was written from', () => {
    const rows = [
      { key: 'app.example-name', value: 'x,y' },
      { key: 'plain' },
      { key: 'gone', absent: true },
      { key: 'empty', value: '' },
    ];
    expect(parseLabelSelect(labelSelect(rows))).toEqual(rows);
  });

  it('reads no rows from an empty expression', () => {
    expect(parseLabelSelect('')).toEqual([]);
  });

  it.each([
    'key!=value',
    'key~part',
    '!key=value',
    '!key!=value',
    'a,,b',
    'bad(key)=x',
    'a,b~c',
  ])('cannot show the expression %j as rows', (expression) => {
    expect(parseLabelSelect(expression)).toBeNull();
  });

  it('splits an expression at the commas that are not escaped', () => {
    expect(splitTerms('a=1,b\\,c=2,d')).toEqual(['a=1', 'b\\,c=2', 'd']);
    expect(splitTerms('')).toEqual([]);
    expect(splitTerms(undefined)).toEqual([]);
  });

  it('joins terms into an expression and none into no expression', () => {
    expect(joinTerms(['a=1', 'b'])).toBe('a=1,b');
    expect(joinTerms([])).toBeUndefined();
  });

  it('lists the keys of the labels of objects once each in alphabetical order', () => {
    expect(
      labelKeysOf([
        { pulp_labels: { team: 'a', tier: null } },
        { pulp_labels: { team: 'b' } },
        { pulp_labels: null },
        {},
        { pulp_labels: { 'app.example-name': 'x' } },
      ]),
    ).toEqual(['app.example-name', 'team', 'tier']);
  });
});

describe('Unit: the label rules', { tags: ['unit'] }, () => {
  it('accepts keys with a dot, a hyphen, a space and an underscore', () => {
    for (const key of [
      'app.example-name',
      'app.kubernetes.io-name',
      'my key',
      'a_b',
      'Za\u017c\u00f3\u0142\u0107',
    ]) {
      expect(labelKeyProblem(key)).toBeNull();
      expect(LABEL_KEY_PATTERN.test(key)).toBe(true);
    }
  });

  it('refuses an empty key and a key with a character the server refuses', () => {
    expect(labelKeyProblem('')).toBe('empty');
    expect(labelKeyProblem('a,b')).toBe('characters');
    expect(labelKeyProblem('a=b')).toBe('characters');
    expect(labelKeyProblem('a(b)')).toBe('characters');
    expect(labelKeyProblem('!a')).toBe('characters');
    expect(labelKeyProblem('a/b')).toBe('characters');
  });

  it('refuses a value with a parenthesis and accepts every other value', () => {
    expect(labelValueProblem('a(b')).toBe('parentheses');
    expect(labelValueProblem('a)b')).toBe('parentheses');
    expect(labelValueProblem('a,b')).toBeNull();
    expect(labelValueProblem('')).toBeNull();
    expect(labelValueProblem('x: y = z')).toBeNull();
  });
});
