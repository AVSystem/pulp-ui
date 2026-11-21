import { t } from '@lingui/core/macro';
import { Form, FormGroup, TextInput } from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { AlertType } from 'src/components';
import { FormFieldHelper } from 'src/components';
import { entityKeys } from 'src/entities/plugin/queries';
import type { Options } from 'src/entities/plugin/request';
import { problemText } from '../form/labels-field';
import { labelKeyProblem, labelValueProblem } from '../labels/label-rules';
import {
  type BulkTarget,
  type OnSettled,
  bulkSetLabel,
  bulkUnsetLabel,
} from './bulk-actions';
import { BulkDialog } from './bulk-dialog';

// The row of a label change: the labels it was read with, which decide whether
// removing a key has anything to do.
interface LabelRow extends BulkTarget {
  pulp_labels?: Record<string, string | null> | null;
}

interface LabelEntity {
  readonly app: string;
  readonly object: string;
  setLabel: (
    href: string,
    label: { key: string; value: string | null },
    options?: Options,
  ) => Promise<unknown>;
  unsetLabel: (
    href: string,
    key: string,
    options?: Options,
  ) => Promise<unknown>;
}

interface Props {
  mode: 'add' | 'remove';
  entity: LabelEntity;
  // The rows the user may change.
  rows: readonly LabelRow[];
  notPermitted: readonly string[];
  onClose: () => void;
  onFinished: (alert: AlertType) => void;
}

// Adds a label to every selected row, or removes a key from every selected row
// that has it, with the rules of a single label: the key and the value are
// refused here exactly when the server would refuse them. Removing a key a row
// does not have is not a failure: the row is skipped, without a request.
export const LabelBulkDialog = ({
  mode,
  entity,
  rows,
  notPermitted,
  onClose,
  onFinished,
}: Props) => {
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const keyProblem = mode === 'add' && key !== '' ? labelKeyProblem(key) : null;
  const valueProblem = mode === 'add' ? labelValueProblem(value) : null;
  const canStart = key !== '' && keyProblem === null && valueProblem === null;

  // While a key is typed for a removal, the rows that lack it say so.
  const listed = useMemo(
    () =>
      rows.map(({ pulp_href, name, pulp_labels }) => ({
        pulp_href,
        name,
        note:
          mode === 'remove' &&
          key !== '' &&
          !Object.keys(pulp_labels ?? {}).includes(key)
            ? t`Does not have this label, so it is skipped`
            : undefined,
      })),
    [rows, mode, key],
  );

  const run = (onSettled: OnSettled) =>
    mode === 'add'
      ? bulkSetLabel(
          entity,
          rows,
          { key, value: value === '' ? null : value },
          onSettled,
        )
      : bulkUnsetLabel(entity, rows, key, onSettled);

  return (
    <BulkDialog
      title={
        mode === 'add'
          ? t`Add label to selected`
          : t`Remove label from selected`
      }
      lead={
        mode === 'add'
          ? t`The label is set on every selected row. A row that already has the key gets the new value.`
          : t`The key is removed from every selected row that has it.`
      }
      confirmLabel={mode === 'add' ? t`Add label` : t`Remove label`}
      isDanger={false}
      rows={listed}
      notPermitted={notPermitted}
      canStart={canStart}
      options={
        <Form
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <FormGroup label={t`Label key`} isRequired fieldId='bulk-label-key'>
            <TextInput
              id='bulk-label-key'
              aria-label={t`Label key`}
              value={key}
              validated={keyProblem ? 'error' : 'default'}
              onChange={(_event, next) => setKey(next)}
            />
            {keyProblem ? (
              <FormFieldHelper variant='error'>
                {problemText(keyProblem)}
              </FormFieldHelper>
            ) : null}
          </FormGroup>
          {mode === 'add' ? (
            <FormGroup label={t`Label value`} fieldId='bulk-label-value'>
              <TextInput
                id='bulk-label-value'
                aria-label={t`Label value`}
                value={value}
                validated={valueProblem ? 'error' : 'default'}
                onChange={(_event, next) => setValue(next)}
              />
              {valueProblem ? (
                <FormFieldHelper variant='error'>
                  {problemText(valueProblem)}
                </FormFieldHelper>
              ) : null}
            </FormGroup>
          ) : null}
        </Form>
      }
      run={run}
      // What the rows hold is stale as soon as anything was sent.
      afterRun={() =>
        void queryClient.invalidateQueries({ queryKey: entityKeys(entity).all })
      }
      alertTitle={() =>
        mode === 'add'
          ? t`Adding the label to the selected rows finished`
          : t`Removing the label from the selected rows finished`
      }
      onClose={onClose}
      onFinished={onFinished}
    />
  );
};
