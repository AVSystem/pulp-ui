import { t } from '@lingui/core/macro';
import {
  ActionGroup,
  Button,
  FormGroup,
  Label,
  TextInput,
} from '@patternfly/react-core';
import { useState } from 'react';
import {
  Alert,
  DataForm,
  FormFieldHelper,
  HelpButton,
  Typeahead,
} from 'src/components';
import { useGroups } from 'src/entities/core/group/queries';
import type { UserFormValues } from 'src/entities/core/user/form';
import { type ErrorMessagesType } from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';

interface IProps {
  errorMessages: ErrorMessagesType;
  isMe?: boolean;
  isNewUser?: boolean;
  isReadonly?: boolean;
  onCancel?: () => void;
  saveUser?: () => void;
  updateUser: (user: UserFormValues, errorMesssages: object) => void;
  user: UserFormValues;
}

export const UserForm = ({
  errorMessages,
  isMe,
  isNewUser,
  isReadonly,
  onCancel,
  saveUser,
  updateUser,
  user,
}: IProps) => {
  const [passwordConfirm, setPasswordConfirm] = useState<string>('');
  // the text the group search is for; every other text is another search
  const [groupFilter, setGroupFilter] = useState<string>('');

  // Only a form that draws the group search reads groups: the form of the own
  // profile and a read-only form show the groups of the record and ask the
  // server for no list.
  const drawsGroupSearch = !isMe && !isReadonly;
  const groups = useGroups(
    { name__contains: groupFilter, page_size: 5 },
    { enabled: drawsGroupSearch },
  );
  const searchGroups = groups.data?.results ?? [];
  // The session ended: the sign-in dialog explains it and the groups read again
  // after signing in.
  const groupsFailed = groups.isError && !isSessionEnd(groups.error);

  const minLength = 9; // actually counts codepoints, close enough

  const formFields = [
    { id: 'username', title: t`Username` },
    { id: 'first_name', title: t`First name` },
    { id: 'last_name', title: t`Last name` },
    { id: 'email', title: t`Email` },
    !isReadonly && {
      id: 'password',
      title: t`Password`,
      type: 'password',
      placeholder: isNewUser ? '' : '••••••••••••••••••••••',
      formGroupLabelIcon: (
        <HelpButton
          content={t`Create a password using at least ${minLength} characters, including special characters , ex <!@$%>. Avoid using common names or expressions.`}
        />
      ),
    },
  ];
  const requiredFields = ['username', ...(isNewUser ? ['password'] : [])];

  const passwordConfirmGroup = () => (
    <FormGroup
      fieldId='password-confirm'
      isRequired={isNewUser || !!user.password}
      key='confirm-group'
      label={t`Password confirmation`}
    >
      <TextInput
        placeholder={isNewUser ? '' : '••••••••••••••••••••••'}
        validated={
          samePass(user.password, passwordConfirm) ? 'default' : 'error'
        }
        isDisabled={isReadonly}
        id='password-confirm'
        value={passwordConfirm}
        onChange={(_event, value) => {
          setPasswordConfirm(value);
        }}
        type='password'
        autoComplete='off'
      />
      <FormFieldHelper
        variant={samePass(user.password, passwordConfirm) ? 'default' : 'error'}
      >
        {samePass(user.password, passwordConfirm)
          ? null
          : t`Passwords do not match`}
      </FormFieldHelper>
    </FormGroup>
  );

  const readonlyGroups = () =>
    user.groups.length ? (
      <FormGroup
        fieldId='groups'
        key='readonlyGroups'
        label={t`Groups`}
        data-cy='UserForm-readonly-groups'
      >
        {user.groups.map((group) => (
          <Label key={group.name}>{group.name}</Label>
        ))}
      </FormGroup>
    ) : null;

  const editGroups = () => (
    <FormGroup fieldId='groups' key='editGroups' label={t`Groups`}>
      {groupsFailed ? (
        <Alert
          title={t`Groups list could not be displayed.`}
          variant='danger'
          isInline
        >
          {requestErrorDescription(groups.error)}
        </Alert>
      ) : (
        <Typeahead
          results={searchGroups}
          loadResults={setGroupFilter}
          onSelect={onSelectGroup}
          placeholderText={t`Select groups`}
          selections={user.groups.map(({ id, name }) => ({
            id: id ?? name,
            name,
          }))}
          multiple
          onClear={clearGroups}
          isDisabled={isReadonly}
        />
      )}
      <FormFieldHelper
        variant={'groups' in errorMessages ? 'error' : 'default'}
      >
        {errorMessages['groups']}
      </FormFieldHelper>
    </FormGroup>
  );

  const formButtons = () => (
    <ActionGroup key='actions'>
      <Button
        type='submit'
        isDisabled={
          !isPassValid(user.password, passwordConfirm) || !requiredFilled(user)
        }
      >
        {t`Save`}
      </Button>
      <Button key='cancel' onClick={() => onCancel()} variant='link'>
        {t`Cancel`}
      </Button>
    </ActionGroup>
  );

  const formSuffix = [
    !isReadonly && passwordConfirmGroup(),
    isMe || isReadonly ? readonlyGroups() : editGroups(),
    errorMessages.non_field_errors ? (
      <FormFieldHelper variant='error'>
        {errorMessages.non_field_errors}
      </FormFieldHelper>
    ) : null,
    // what belongs to no field, such as a refused save: Pulp's reason is plain
    // text that wraps instead of widening the form
    errorMessages['__nofield'] ? (
      <p
        key='nofield'
        className='pulp-break-anywhere'
        style={{
          color: 'var(--pf-t--global--text--color--status--danger--default)',
        }}
      >
        {errorMessages['__nofield']}
      </p>
    ) : null,
    !isReadonly && formButtons(),
  ];

  return (
    <DataForm
      errorMessages={errorMessages}
      formFields={formFields}
      formSuffix={<>{formSuffix}</>}
      isReadonly={isReadonly}
      model={user}
      requiredFields={requiredFields}
      updateField={(e, v) => updateField(v, e)}
      onSave={() => saveUser()}
    />
  );

  function clearGroups() {
    const newUser = { ...user };
    newUser.groups = [];
    updateUser(newUser, errorMessages);
  }

  // The user the parent holds is never changed in place: the parent gets a new
  // user with a new list. A group that is no longer in the list of results
  // (the search moved on) is not added.
  function onSelectGroup(event, selection) {
    const selected = user.groups.some((g) => g.name === selection);
    let groups: typeof user.groups;
    if (selected) {
      groups = user.groups.filter((g) => g.name !== selection);
    } else {
      const addedGroup = searchGroups.find((g) => g.name === selection);
      if (!addedGroup) {
        return;
      }
      groups = [...user.groups, { id: addedGroup.id, name: addedGroup.name }];
    }

    updateUser({ ...user, groups }, errorMessages);
  }

  // confirm is empty, or matches password
  function samePass(pass, confirm) {
    return !confirm || pass === confirm;
  }

  // both passwords missing, or both match
  function isPassValid(pass, confirm) {
    return !(pass || confirm) || pass === confirm;
  }

  function requiredFilled(user) {
    if (isNewUser) {
      return !!user.password && !!user.username;
    } else {
      return !!user.username;
    }
  }

  function updateUserFieldByName(value, field) {
    const newMessages = { ...errorMessages };

    const update = { ...user };
    update[field] = value;
    if (field in newMessages) {
      delete newMessages[field];
    }
    updateUser(update, newMessages);
  }

  function updateField(value, event) {
    updateUserFieldByName(value, event.target.id);
  }
};
