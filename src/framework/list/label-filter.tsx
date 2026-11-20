import { t } from '@lingui/core/macro';
import {
  Badge,
  Button,
  Checkbox,
  Flex,
  FlexItem,
  Form,
  FormHelperText,
  HelperText,
  HelperTextItem,
  TextInput,
} from '@patternfly/react-core';
import MinusCircleIcon from '@patternfly/react-icons/dist/esm/icons/minus-circle-icon';
import PlusCircleIcon from '@patternfly/react-icons/dist/esm/icons/plus-circle-icon';
import TagIcon from '@patternfly/react-icons/dist/esm/icons/tag-icon';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Popover } from 'src/components';
import {
  type LabelKeyProblem,
  type LabelValueProblem,
  labelKeyProblem,
  labelValueProblem,
} from '../labels/label-rules';
import {
  type LabelRow,
  labelSelect,
  parseLabelSelect,
  splitTerms,
} from '../labels/label-select';

interface Props {
  // The expression the list is filtered by now, or undefined when there is no
  // label filter.
  expression: string | undefined;
  // Called with the expression to filter by, or undefined to remove the
  // filter.
  onApply: (expression: string | undefined) => void;
  // The keys offered while a key is typed.
  suggestions: readonly string[];
  // The text the server gave when it refused the current expression, or null.
  // The panel opens on it and shows it at the input.
  refusal: string | null;
}

// A condition being edited. The text fields hold what is typed, which may not
// be fit to send yet.
interface Condition {
  id: number;
  key: string;
  value: string;
  absent: boolean;
}

// The conditions of an expression: its rows, or null when only text can show it.
function conditionsOf(
  expression: string | undefined,
  nextId: () => number,
): Condition[] | null {
  const rows = parseLabelSelect(expression ?? '');
  if (rows === null) {
    return null;
  }
  const conditions = rows.map((row) => ({
    id: nextId(),
    key: row.key,
    value: row.value ?? '',
    absent: row.absent ?? false,
  }));
  return conditions.length > 0
    ? conditions
    : [{ id: nextId(), key: '', value: '', absent: false }];
}

// A condition with nothing typed is not a condition: it is left out.
const isBlank = (condition: Condition) =>
  condition.key.trim() === '' && condition.value === '' && !condition.absent;

function rowOf({ key, value, absent }: Condition): LabelRow {
  return {
    key: key.trim(),
    value: absent || value.trim() === '' ? undefined : value.trim(),
    absent,
  };
}

// How a comma is written inside a value of an expression.
const ESCAPED_COMMA = '\\,';

function keyMessage(problem: LabelKeyProblem) {
  return problem === 'empty'
    ? t`Enter a label key.`
    : t`A key may hold letters, digits, spaces, dots, hyphens and underscores.`;
}

function valueMessage(_problem: LabelValueProblem) {
  return t`A value may not contain parentheses.`;
}

// The label filter of a list: a button that opens a panel with key and value
// rows (every row must hold, a key alone asks for the key, "Not set" asks for
// its absence) or, for what rows cannot say, a text input that sends a
// `pulp_label_select` expression as it is typed. The server has the last word
// on an expression; when it refuses one, the panel opens with the server's
// reason at the input. Applying replaces the filter; the list starts again
// from its first page, which is the list's to decide.
export const LabelFilter = ({
  expression,
  onApply,
  suggestions,
  refusal,
}: Props) => {
  const listId = useId();
  const counter = useRef(0);
  const nextId = useCallback(() => {
    counter.current += 1;
    return counter.current;
  }, []);

  const [isOpen, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [text, setText] = useState('');

  // Starts the panel from the expression of the address, in rows when they can
  // hold it.
  const open = useCallback(() => {
    const rows = conditionsOf(expression, nextId);
    setAdvanced(rows === null);
    setConditions(
      rows ?? [{ id: nextId(), key: '', value: '', absent: false }],
    );
    setText(expression ?? '');
    setOpen(true);
  }, [expression, nextId]);

  // A refused expression brings the panel up, with the text that was refused.
  // `open` changes with the address, so a refusal that has the same text as the
  // last one still shows.
  useEffect(() => {
    if (refusal) {
      open();
    }
  }, [refusal, open]);

  const live = conditions.filter((condition) => !isBlank(condition));
  const problems = live.map((condition) => ({
    key: labelKeyProblem(condition.key.trim()),
    value: condition.absent ? null : labelValueProblem(condition.value),
  }));
  const blocked = advanced
    ? false
    : problems.some(({ key, value }) => key !== null || value !== null);

  const update = (id: number, change: Partial<Condition>) =>
    setConditions((current) =>
      current.map((condition) =>
        condition.id === id ? { ...condition, ...change } : condition,
      ),
    );

  const apply = () => {
    if (blocked) {
      return;
    }
    const next = advanced
      ? text.trim()
      : labelSelect(live.map((condition) => rowOf(condition)));
    setOpen(false);
    onApply(next === '' ? undefined : next);
  };

  const clear = () => {
    setOpen(false);
    onApply(undefined);
  };

  // Rows cannot show some expressions, so the way back to rows is closed for
  // them.
  const rowsFromText = advanced ? parseLabelSelect(text.trim()) : null;

  const switchMode = () => {
    if (advanced) {
      setConditions(
        conditionsOf(text.trim(), nextId) ?? [
          { id: nextId(), key: '', value: '', absent: false },
        ],
      );
      setAdvanced(false);
    } else {
      setText(labelSelect(live.map((condition) => rowOf(condition))));
      setAdvanced(true);
    }
  };

  const count = splitTerms(expression).length;

  const body = (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      {advanced ? (
        <>
          <TextInput
            aria-label={t`Label expression`}
            value={text}
            onChange={(_event, value) => setText(value)}
            validated={refusal ? 'error' : 'default'}
            autoComplete='off'
            spellCheck={false}
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem>
                {t`Separate terms with commas and write key=value, key or !key. Write ${ESCAPED_COMMA} for a comma in a value.`}
              </HelperTextItem>
              {refusal ? (
                <HelperTextItem
                  variant='error'
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {refusal}
                </HelperTextItem>
              ) : null}
              {rowsFromText === null ? (
                <HelperTextItem>
                  {t`This expression cannot be shown as fields.`}
                </HelperTextItem>
              ) : null}
            </HelperText>
          </FormHelperText>
        </>
      ) : (
        <>
          <datalist id={listId}>
            {suggestions.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
          {conditions.map((condition) => {
            const at = live.indexOf(condition);
            const problem = at === -1 ? undefined : problems[at];
            return (
              <div key={condition.id}>
                <Flex
                  alignItems={{ default: 'alignItemsCenter' }}
                  flexWrap={{ default: 'nowrap' }}
                  gap={{ default: 'gapSm' }}
                >
                  <FlexItem grow={{ default: 'grow' }}>
                    <TextInput
                      aria-label={t`Label key`}
                      placeholder={t`Key`}
                      list={listId}
                      value={condition.key}
                      validated={problem?.key ? 'error' : 'default'}
                      onChange={(_event, key) => update(condition.id, { key })}
                      autoComplete='off'
                      spellCheck={false}
                    />
                  </FlexItem>
                  <FlexItem grow={{ default: 'grow' }}>
                    <TextInput
                      aria-label={t`Label value`}
                      placeholder={t`Value (optional)`}
                      value={condition.value}
                      isDisabled={condition.absent}
                      validated={problem?.value ? 'error' : 'default'}
                      onChange={(_event, value) =>
                        update(condition.id, { value })
                      }
                      autoComplete='off'
                      spellCheck={false}
                    />
                  </FlexItem>
                  <FlexItem>
                    <Checkbox
                      id={`${listId}-absent-${condition.id}`}
                      label={t`Not set`}
                      isChecked={condition.absent}
                      onChange={(_event, absent) =>
                        update(condition.id, { absent })
                      }
                    />
                  </FlexItem>
                  <FlexItem>
                    <Button
                      variant='plain'
                      aria-label={t`Remove label condition`}
                      icon={<MinusCircleIcon />}
                      onClick={() =>
                        setConditions((current) =>
                          current.length > 1
                            ? current.filter(({ id }) => id !== condition.id)
                            : [
                                {
                                  ...condition,
                                  key: '',
                                  value: '',
                                  absent: false,
                                },
                              ],
                        )
                      }
                    />
                  </FlexItem>
                </Flex>
                {problem?.key || problem?.value ? (
                  <FormHelperText>
                    <HelperText>
                      {problem.key ? (
                        <HelperTextItem variant='error'>
                          {keyMessage(problem.key)}
                        </HelperTextItem>
                      ) : null}
                      {problem.value ? (
                        <HelperTextItem variant='error'>
                          {valueMessage(problem.value)}
                        </HelperTextItem>
                      ) : null}
                    </HelperText>
                  </FormHelperText>
                ) : null}
              </div>
            );
          })}
          {refusal ? (
            <FormHelperText>
              <HelperText>
                <HelperTextItem
                  variant='error'
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {refusal}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          ) : null}
          <div>
            <Button
              variant='link'
              isInline
              icon={<PlusCircleIcon />}
              onClick={() =>
                setConditions((current) => [
                  ...current,
                  { id: nextId(), key: '', value: '', absent: false },
                ])
              }
            >
              {t`Add label condition`}
            </Button>
          </div>
        </>
      )}
      <Flex gap={{ default: 'gapSm' }}>
        <FlexItem>
          <Button type='submit' variant='primary' isDisabled={blocked}>
            {t`Apply`}
          </Button>
        </FlexItem>
        <FlexItem>
          <Button variant='link' onClick={clear}>
            {t`Clear`}
          </Button>
        </FlexItem>
        <FlexItem align={{ default: 'alignRight' }}>
          <Button
            variant='link'
            isInline
            isDisabled={advanced && rowsFromText === null}
            onClick={switchMode}
          >
            {advanced ? t`Use key and value fields` : t`Write an expression`}
          </Button>
        </FlexItem>
      </Flex>
    </Form>
  );

  return (
    <Popover
      aria-label={t`Filter by labels`}
      headerContent={t`Filter by labels`}
      bodyContent={body}
      isVisible={isOpen}
      shouldOpen={() => open()}
      shouldClose={() => setOpen(false)}
      position='bottom-start'
      minWidth='34rem'
      maxWidth='42rem'
    >
      <Button variant='control' icon={<TagIcon />}>
        {t`Labels`}
        {count > 0 ? (
          <>
            {' '}
            <Badge isRead>{count}</Badge>
          </>
        ) : null}
      </Button>
    </Popover>
  );
};
