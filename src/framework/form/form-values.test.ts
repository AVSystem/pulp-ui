import { msg } from '@lingui/core/macro';
import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../descriptor';
import {
  type LabelRow,
  changedNames,
  hasProblems,
  labelProblem,
  missingRequired,
  toCreateBody,
  toFilledBody,
  toForm,
  toRequest,
} from './form-values';

const fields: FieldDef[] = [
  { name: 'description', label: msg`Description`, kind: 'text' },
  { name: 'retain', label: msg`Retain`, kind: 'integer' },
  { name: 'publish', label: msg`Publish`, kind: 'boolean' },
  { name: 'mode', label: msg`Mode`, kind: 'select' },
  { name: 'labels', label: msg`Labels`, kind: 'labels' },
  { name: 'remote', label: msg`Remote`, kind: 'remote' },
];

describe('Unit: the values of a descriptor form', { tags: ['unit'] }, () => {
  it('holds what an input shows: text for a number, rows for labels, none for a missing remote', () => {
    expect(
      toForm(fields, {
        description: null,
        retain: 3,
        publish: undefined,
        labels: { team: 'a', tier: null },
      }),
    ).toEqual({
      description: '',
      retain: '3',
      publish: false,
      mode: '',
      labels: [
        { key: 'team', value: 'a' },
        { key: 'tier', value: '' },
      ],
      remote: null,
    });
  });

  it('turns the values of the named fields into what the server takes', () => {
    const values = {
      description: '',
      retain: ' 7 ',
      publish: true,
      mode: 'root',
      labels: [
        { key: 'team', value: 'a' },
        { key: 'tier', value: '' },
        { key: '', value: '' },
      ],
      remote: '/pulp/api/v3/remotes/file/file/1/',
    };

    expect(
      toRequest(fields, values, [
        'description',
        'retain',
        'publish',
        'labels',
        'remote',
      ]),
    ).toEqual({
      description: '',
      retain: 7,
      publish: true,
      labels: { team: 'a', tier: null },
      remote: '/pulp/api/v3/remotes/file/file/1/',
    });
    expect(toRequest(fields, { ...values, retain: '' }, ['retain'])).toEqual({
      retain: null,
    });
  });

  it('names the fields that differ and none of those that do not', () => {
    const before = toForm(fields, { description: 'a', retain: 3 });

    expect(changedNames(fields, before, { ...before })).toEqual([]);
    expect(
      changedNames(fields, before, {
        ...before,
        description: 'b',
        retain: '4',
      }),
    ).toEqual(['description', 'retain']);
  });

  it('finds a label the server would refuse and a key used twice, and ignores an empty row', () => {
    const rows: LabelRow[] = [
      { key: 'team', value: 'a' },
      { key: 'bad/key', value: '' },
      { key: 'tier', value: 'x(y)' },
      { key: '', value: 'orphan' },
      { key: 'team', value: 'b' },
      { key: '', value: '' },
    ];

    expect(rows.map((_row, index) => labelProblem(rows, index))).toEqual([
      null,
      'characters',
      'parentheses',
      'empty',
      'duplicate',
      null,
    ]);
    expect(hasProblems(fields, { labels: rows })).toBe(true);
    expect(hasProblems(fields, { labels: [rows[0], rows[5]] })).toBe(false);
  });
});

describe('Unit: the body of a create', { tags: ['unit'] }, () => {
  it('sends every field, null for a text and a number left blank, false for an unticked box and an object for the labels', () => {
    expect(toCreateBody(fields, toForm(fields, {}))).toStrictEqual({
      description: null,
      retain: null,
      publish: false,
      mode: null,
      labels: {},
      remote: null,
    });
  });

  it('keeps what was typed as it was typed', () => {
    const values = {
      ...toForm(fields, {}),
      description: ' two words ',
      retain: '0',
      publish: true,
      mode: 'root',
      labels: [{ key: 'env', value: '' }],
      remote: '/pulp/api/v3/remotes/file/file/1/',
    };

    expect(toCreateBody(fields, values)).toStrictEqual({
      description: ' two words ',
      retain: 0,
      publish: true,
      mode: 'root',
      labels: { env: null },
      remote: '/pulp/api/v3/remotes/file/file/1/',
    });
  });

  describe('a number the server never takes null for', () => {
    const kept: FieldDef[] = [
      {
        name: 'keep',
        label: msg`Retain`,
        kind: 'integer',
        blankValue: 0,
      },
      { name: 'retain', label: msg`Retain`, kind: 'integer' },
    ];

    it('is sent as its blank value when the input is empty or spaces, and as the number otherwise', () => {
      const names = ['keep', 'retain'];

      expect(toRequest(kept, { keep: '', retain: '' }, names)).toEqual({
        keep: 0,
        retain: null,
      });
      expect(toRequest(kept, { keep: '  ', retain: '' }, names)).toEqual({
        keep: 0,
        retain: null,
      });
      expect(toRequest(kept, { keep: ' 4 ', retain: '5' }, names)).toEqual({
        keep: 4,
        retain: 5,
      });
      expect(toCreateBody(kept, { keep: '', retain: '' })).toEqual({
        keep: 0,
        retain: null,
      });
    });

    it('shows the blank value as an empty input, so keep-all reads as blank and a typed 0 is the same thing', () => {
      expect(toForm(kept, { keep: 0, retain: 0 })).toEqual({
        keep: '',
        retain: '0',
      });
      expect(toForm(kept, { keep: 3, retain: null })).toEqual({
        keep: '3',
        retain: '',
      });
    });

    it('counts emptying the input as a change from a number, and leaving the blank value alone as none', () => {
      const before = toForm(kept, { keep: 3, retain: null });

      expect(changedNames(kept, before, { ...before, keep: '' })).toEqual([
        'keep',
      ]);
      expect(
        changedNames(kept, toForm(kept, { keep: 0, retain: null }), {
          keep: '',
          retain: '',
        }),
      ).toEqual([]);
    });
  });

  describe('a list of lines', () => {
    const lines: FieldDef[] = [
      { name: 'includes', label: msg`Description`, kind: 'lines' },
    ];

    it('shows the items one to a line, and nothing for a missing list', () => {
      expect(toForm(lines, { includes: ['django>=4.2', 'requests'] })).toEqual({
        includes: 'django>=4.2\nrequests',
      });
      expect(toForm(lines, { includes: [] })).toEqual({ includes: '' });
      expect(toForm(lines, { includes: null })).toEqual({ includes: '' });
      expect(toForm(lines, {})).toEqual({ includes: '' });
    });

    it('sends one item for each line that holds something, trimmed, and drops blank lines', () => {
      expect(
        toRequest(lines, { includes: ' django>=4.2 \n\n  \nrequests\n' }, [
          'includes',
        ]),
      ).toEqual({ includes: ['django>=4.2', 'requests'] });
      expect(toRequest(lines, { includes: '' }, ['includes'])).toEqual({
        includes: [],
      });
      expect(toRequest(lines, { includes: 'a\r\nb' }, ['includes'])).toEqual({
        includes: ['a', 'b'],
      });
    });

    it('sends an empty list on a create when it is not filled in, and drops it from a body that sends only what was filled in', () => {
      expect(toCreateBody(lines, { includes: '' })).toEqual({ includes: [] });
      expect(toFilledBody(lines, { includes: ' \n' })).toEqual({});
      expect(toFilledBody(lines, { includes: 'a' })).toEqual({
        includes: ['a'],
      });
    });

    it('counts a change of the text as a change and the same text as none', () => {
      const before = toForm(lines, { includes: ['a'] });

      expect(changedNames(lines, before, { includes: 'a' })).toEqual([]);
      expect(changedNames(lines, before, { includes: 'a\nb' })).toEqual([
        'includes',
      ]);
    });
  });

  describe('a set of choices', () => {
    const choices: FieldDef[] = [
      {
        name: 'types',
        label: msg`Description`,
        kind: 'choices',
        options: [
          { value: 'sdist', label: msg`Mode` },
          { value: 'bdist_wheel', label: msg`Publish` },
          { value: 'bdist_egg', label: msg`Retain` },
        ],
      },
    ];

    it('holds the values that are chosen, in the order of the options, and keeps one the options do not name', () => {
      expect(toForm(choices, { types: ['bdist_egg', 'sdist'] })).toEqual({
        types: ['sdist', 'bdist_egg'],
      });
      expect(toForm(choices, { types: ['future', 'sdist'] })).toEqual({
        types: ['sdist', 'future'],
      });
      expect(toForm(choices, { types: null })).toEqual({ types: [] });
      expect(toForm(choices, {})).toEqual({ types: [] });
    });

    it('sends the chosen values, and an empty list when none is chosen', () => {
      expect(toRequest(choices, { types: ['sdist'] }, ['types'])).toEqual({
        types: ['sdist'],
      });
      expect(toRequest(choices, { types: [] }, ['types'])).toEqual({
        types: [],
      });
      expect(toCreateBody(choices, { types: [] })).toEqual({ types: [] });
      expect(toFilledBody(choices, { types: [] })).toEqual({});
    });

    it('counts choosing or clearing a value as a change', () => {
      const before = toForm(choices, { types: ['sdist'] });

      expect(changedNames(choices, before, { types: ['sdist'] })).toEqual([]);
      expect(
        changedNames(choices, before, { types: ['sdist', 'bdist_egg'] }),
      ).toEqual(['types']);
    });
  });

  describe('a field that is required', () => {
    const required: FieldDef[] = [
      { name: 'name', label: msg`Name`, kind: 'text', required: true },
      { name: 'url', label: msg`URL`, kind: 'url', required: true },
      { name: 'suites', label: msg`Description`, kind: 'text', required: true },
      { name: 'note', label: msg`Mode`, kind: 'text' },
      { name: 'on', label: msg`Publish`, kind: 'boolean', required: true },
    ];
    const filled = {
      name: 'a',
      url: 'https://x.example/',
      suites: 'bookworm',
      note: '',
      on: false,
    };

    it('is missing while its text is empty or only spaces, and never for a field that is not required', () => {
      expect(missingRequired(required, filled)).toBe(false);
      expect(missingRequired(required, { ...filled, suites: '' })).toBe(true);
      expect(missingRequired(required, { ...filled, suites: '  \t' })).toBe(
        true,
      );
      expect(missingRequired(required, { ...filled, note: '' })).toBe(false);
    });

    it('does not take an unticked box for a missing value, because false is an answer', () => {
      expect(missingRequired(required, { ...filled, on: false })).toBe(false);
    });
  });
});
