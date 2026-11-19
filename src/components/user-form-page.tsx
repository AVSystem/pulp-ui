import { type ReactNode } from 'react';
import {
  BaseHeader,
  type BreadcrumbType,
  Breadcrumbs,
  Main,
  UserForm,
} from 'src/components';
import { type UserFormValues } from 'src/entities/core/user/form';
import { type ErrorMessagesType } from 'src/utilities/map-error-messages';

interface IProps {
  breadcrumbs: BreadcrumbType[];
  errorMessages: ErrorMessagesType;
  extraControls?: ReactNode;
  isMe?: boolean;
  isNewUser?: boolean;
  isReadonly?: boolean;
  onCancel?: () => void;
  saveUser?: () => void;
  title: string;
  updateUser: (user: UserFormValues, errorMessages: ErrorMessagesType) => void;
  user: UserFormValues;
}

export const UserFormPage = ({
  breadcrumbs,
  errorMessages,
  extraControls,
  isMe,
  isNewUser,
  isReadonly,
  onCancel,
  saveUser,
  title,
  updateUser,
  user,
}: IProps) => (
  <>
    <BaseHeader
      breadcrumbs={<Breadcrumbs links={breadcrumbs} />}
      pageControls={extraControls}
      title={title}
    />
    <Main>
      <section className='pulp-section'>
        <UserForm
          isMe={isMe}
          isReadonly={isReadonly}
          user={user}
          updateUser={updateUser}
          errorMessages={errorMessages}
          saveUser={saveUser}
          onCancel={onCancel}
          isNewUser={isNewUser}
        />
      </section>
    </Main>
  </>
);
