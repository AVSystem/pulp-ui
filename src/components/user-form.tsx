import { t } from '@lingui/core/macro';
import {
  ActionGroup,
  Button,
  FormGroup,
  Label,
  TextInput,
} from '@patternfly/react-core';
import { useEffect, useRef, useState } from 'react';
import { GroupAPI, type UserType } from 'src/api';
import {
  Alert,
  type AlertType,
  DataForm,
  FormFieldHelper,
  HelpButton,
  Typeahead,
} from 'src/components';
import { useSessionEpoch } from 'src/user-context';
import { type ErrorMessagesType } from 'src/utilities';
import { useLatestRead } from 'src/utilities/latest-read';
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
  updateUser: (user: UserType, errorMesssages: object) => void;
  user: UserType;
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
  const [formErrors, setFormErrors] = useState<{ groups: AlertType }>({
    groups: null,
  });
  const [passwordConfirm, setPasswordConfirm] = useState<string>('');
  const [searchGroups, setSearchGroups] = useState<
    { name: string; id: number }[]
  >([]);

  // grows when the same user signs in again, so the group list reads again
  const epoch = useSessionEpoch();
  // the filter of the latest group search, so a re-read keeps the shown list
  const groupFilter = useRef('');
  // numbers the group searches, so only the answer to the latest one is used
  const groupSearches = useLatestRead();

  useEffect(() => {
    loadGroups(groupFilter.current);
  }, [epoch]);

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
      {formErrors.groups ? (
        <Alert title={formErrors.groups.title} variant='danger' isInline>
          {formErrors.groups.description}
        </Alert>
      ) : (
        <Typeahead
          results={searchGroups}
          loadResults={loadGroups}
          onSelect={onSelectGroup}
          placeholderText={t`Select groups`}
          selections={user.groups}
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
      groups = [...user.groups, addedGroup];
    }

    updateUser({ ...user, groups }, errorMessages);
  }

  function loadGroups(name) {
    groupFilter.current = name;
    const search = groupSearches.start();
    GroupAPI.list({ name__contains: name, page_size: 5 })
      .then((result) => {
        if (!groupSearches.isLatest(search)) {
          return;
        }
        setSearchGroups(result.data.results);
        // a read that succeeds ends an earlier failure of the field
        setFormErrors((errors) =>
          errors.groups ? { ...errors, groups: null } : errors,
        );
      })
      .catch((e) => {
        // The session ended: the sign-in dialog explains it and the groups
        // read again after signing in.
        if (isSessionEnd(e) || !groupSearches.isLatest(search)) {
          return;
        }
        setFormErrors((errors) => ({
          ...errors,
          groups: {
            variant: 'danger',
            title: t`Groups list could not be displayed.`,
            description: requestErrorDescription(e),
          },
        }));
      });
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
