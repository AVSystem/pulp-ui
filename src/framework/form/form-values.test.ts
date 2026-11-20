import { msg } from '@lingui/core/macro';
import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../descriptor';
import {
  type LabelRow,
  changedNames,
  hasProblems,
  labelProblem,
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
