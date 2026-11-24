import { t } from '@lingui/core/macro';
import {
  Button,
  Flex,
  FlexItem,
  InputGroup,
  InputGroupItem,
  Label,
  TextInput,
} from '@patternfly/react-core';
import PencilAltIcon from '@patternfly/react-icons/dist/esm/icons/pencil-alt-icon';
import { type ReactNode, useRef, useState } from 'react';
import { Alert, FormFieldHelper, LabelGroup } from 'src/components';
import { useSetLabel, useUnsetLabel } from 'src/entities/plugin/queries';
import type { Options } from 'src/entities/plugin/request';
import { problemText } from '../form/labels-field';
import { type SaveFailure, saveFailure } from '../form/save-errors';
import { LabelChips } from './label-chips';
import { labelKeyProblem, labelValueProblem } from './label-rules';

// What the editor needs of the entity of the object whose labels it edits.
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
  // The object, with the labels the server holds for it now.
  object: {
    pulp_href: string;
    pulp_labels?: Record<string, string | null> | null;
  };
  entity: LabelEntity;
  // Whether the user may change the object's labels. The decision is taken by
  // the screen; without it the labels are chips and nothing more.
  canEdit: boolean;
  // Opens with the inputs shown, for an editor that is the whole content of a
  // dialog.
  initiallyEditing?: boolean;
  // Called when the user is done instead of folding the editor back into the
  // chips, for the screen that closes the dialog it sits in.
  onDone?: () => void;
}

// The labels of an object, and for a user who may change them an editor: each
// label can be removed with one request, and a key with a value is added or
// changed with one request. The rules a key and a value must follow are the
// server's, shown as soon as the text breaks them, and nothing is sent that
// the server would refuse for them. The labels shown are always the ones the
// object was read with: a change is shown once the server has made it and the
// object has been read again.
//
// A refusal or failure is shown in the editor, which stays open with what was
// typed. The end of the session is not shown (the sign-in dialog explains it)
// and loses nothing.
export const LabelEditor = ({
  object,
  entity,
  canEdit,
  initiallyEditing = false,
  onDone,
}: Props) => {
  const [editing, setEditing] = useState(initiallyEditing);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const set = useSetLabel(entity);
  const unset = useUnsetLabel(entity);
  const sending = useRef(false);
  const busy = set.isPending || unset.isPending;
  const labels = object.pulp_labels ?? {};

  if (!canEdit || !editing) {
    return (
      <>
        <LabelChips labels={labels} />
        {canEdit ? (
          <div>
            <Button
              variant='link'
              isInline
              icon={<PencilAltIcon />}
              onClick={() => setEditing(true)}
            >
              {t`Edit labels`}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  const keyProblem = key === '' ? null : labelKeyProblem(key);
  const valueProblem = labelValueProblem(value);
  const problem = keyProblem ?? valueProblem;
  const canAdd = key !== '' && problem === null && !busy;

  // Runs one change. Only one is sent at a time; a failure is shown and
  // nothing is retried.
  async function send(change: () => Promise<unknown>, done?: () => void) {
    if (sending.current) {
      return;
    }
    sending.current = true;
    setFailure(null);
    try {
      await change();
      done?.();
    } catch (error) {
      setFailure(saveFailure(error, ['key', 'value']));
    } finally {
      sending.current = false;
    }
  }

  const add = () =>
    send(
      () =>
        set.mutateAsync({
          href: object.pulp_href,
          key,
          value: value === '' ? null : value,
        }),
      () => {
        setKey('');
        setValue('');
      },
    );
  const remove = (labelKey: string) =>
    send(() => unset.mutateAsync({ href: object.pulp_href, key: labelKey }));

  const entries = Object.entries(labels);
  const fieldMessage = (name: string): ReactNode =>
    failure?.fields[name] ? (
      <FormFieldHelper variant='error'>{failure.fields[name]}</FormFieldHelper>
    ) : null;

  return (
    <div>
      {entries.length === 0 ? (
        <p>{t`None`}</p>
      ) : (
        <LabelGroup>
          {entries.map(([name, text]) => (
            <Label
              key={name}
              onClick={() => {
                setKey(name);
                setValue(text ?? '');
              }}
              onClose={() => remove(name)}
              closeBtnProps={{
                isDisabled: busy,
                'aria-label': t`Remove label ${name}`,
              }}
            >
              {text ? `${name}: ${text}` : name}
            </Label>
          ))}
        </LabelGroup>
      )}

      <InputGroup style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
        <InputGroupItem isFill>
          <TextInput
            aria-label={t`Label key`}
            placeholder={t`Key`}
            value={key}
            isDisabled={busy}
            validated={
              keyProblem || failure?.fields['key'] ? 'error' : 'default'
            }
            onChange={(_event, next) => setKey(next)}
          />
        </InputGroupItem>
        <InputGroupItem isFill>
          <TextInput
            aria-label={t`Label value`}
            placeholder={t`Value`}
            value={value}
            isDisabled={busy}
            validated={
              valueProblem || failure?.fields['value'] ? 'error' : 'default'
            }
            onChange={(_event, next) => setValue(next)}
          />
        </InputGroupItem>
        <InputGroupItem>
          <Button variant='secondary' isDisabled={!canAdd} onClick={add}>
            {t`Add label`}
          </Button>
        </InputGroupItem>
      </InputGroup>
      {keyProblem ? (
        <FormFieldHelper variant='error'>
          {problemText(keyProblem)}
        </FormFieldHelper>
      ) : null}
      {valueProblem ? (
        <FormFieldHelper variant='error'>
          {problemText(valueProblem)}
        </FormFieldHelper>
      ) : null}
      {fieldMessage('key')}
      {fieldMessage('value')}
      {failure?.general ? (
        <Alert
          isInline
          variant='danger'
          title={t`The label could not be changed.`}
          style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}
        >
          {failure.general}
        </Alert>
      ) : null}

      <Flex style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
        <FlexItem>
          <Button
            variant='link'
            isInline
            isDisabled={busy}
            onClick={() => {
              setEditing(false);
              setFailure(null);
              onDone?.();
            }}
          >
            {t`Done`}
          </Button>
        </FlexItem>
      </Flex>
    </div>
  );
};
