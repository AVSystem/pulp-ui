import { t } from '@lingui/core/macro';
import {
  Button,
  InputGroup,
  InputGroupItem,
  TextInput,
} from '@patternfly/react-core';
import PlusCircleIcon from '@patternfly/react-icons/dist/esm/icons/plus-circle-icon';
import TimesIcon from '@patternfly/react-icons/dist/esm/icons/times-icon';
import { FormFieldHelper } from 'src/components';
import { type LabelProblem, type LabelRow, labelProblem } from './form-values';

interface Props {
  id: string;
  rows: LabelRow[];
  onChange: (rows: LabelRow[]) => void;
  isDisabled: boolean;
}

export const problemText = (problem: LabelProblem): string => {
  switch (problem) {
    case 'empty':
      return t`Enter a key for this label.`;
    case 'characters':
      return t`A label key can contain only letters, digits, underscores, spaces, dots and hyphens.`;
    case 'parentheses':
      return t`A label value cannot contain parentheses.`;
    case 'duplicate':
      return t`Each label key can be used once.`;
  }
};

// The labels of an object as pairs of a key and an optional value, one row per
// label, with the reason under a row the server would refuse. A new row is
// empty and counts as a label only once something is typed into it.
export const LabelsField = ({ id, rows, onChange, isDisabled }: Props) => {
  const change = (index: number, next: Partial<LabelRow>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...next } : row)));

  return (
    <div id={id}>
      {rows.length === 0 ? <p>{t`None`}</p> : null}
      {rows.map((row, index) => {
        const problem = labelProblem(rows, index);

        return (
          <div
            key={index}
            style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}
          >
            <InputGroup>
              <InputGroupItem isFill>
                <TextInput
                  aria-label={t`Label key`}
                  placeholder={t`Key`}
                  value={row.key}
                  isDisabled={isDisabled}
                  validated={
                    problem && problem !== 'parentheses' ? 'error' : 'default'
                  }
                  onChange={(_event, key) => change(index, { key })}
                />
              </InputGroupItem>
              <InputGroupItem isFill>
                <TextInput
                  aria-label={t`Label value`}
                  placeholder={t`Value`}
                  value={row.value}
                  isDisabled={isDisabled}
                  validated={problem === 'parentheses' ? 'error' : 'default'}
                  onChange={(_event, value) => change(index, { value })}
                />
              </InputGroupItem>
              <InputGroupItem>
                <Button
                  variant='plain'
                  aria-label={t`Remove label`}
                  icon={<TimesIcon />}
                  isDisabled={isDisabled}
                  onClick={() =>
                    onChange(rows.filter((_row, at) => at !== index))
                  }
                />
              </InputGroupItem>
            </InputGroup>
            {problem ? (
              <FormFieldHelper variant='error'>
                {problemText(problem)}
              </FormFieldHelper>
            ) : null}
          </div>
        );
      })}
      <Button
        variant='link'
        isInline
        icon={<PlusCircleIcon />}
        isDisabled={isDisabled}
        onClick={() => onChange([...rows, { key: '', value: '' }])}
      >
        {t`Add label`}
      </Button>
    </div>
  );
};
