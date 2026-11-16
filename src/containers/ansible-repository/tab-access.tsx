import { t } from '@lingui/core/macro';
import { useEffect, useRef, useState } from 'react';
import {
  AnsibleRepositoryAPI,
  type AnsibleRepositoryType,
  GroupAPI,
  type GroupType,
  type RoleType,
  UserAPI,
} from 'src/api';
import { AccessTab, ListErrorState } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { useSessionEpoch } from 'src/user-context';
import { assignRoles, parsePulpIDFromURL } from 'src/utilities';
import { ACTION_PERMISSIONS } from 'src/utilities/action-permissions';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';

interface UserType {
  username: string;
  object_roles: string[];
}

interface TabProps {
  item: AnsibleRepositoryType;
  actionContext: {
    addAlert: (alert) => void;
    hasObjectPermission: (permission: string, target?: object) => boolean;
    state: { params };
    user;
  };
}

export const RepositoryAccessTab = ({
  item,
  actionContext: {
    addAlert,
    hasObjectPermission,
    state: { params },
  },
}: TabProps) => {
  const id = item?.pulp_href && parsePulpIDFromURL(item.pulp_href);
  const [name] = useState<string>(item?.name);
  const [groups, setGroups] = useState<GroupType[]>(null); // loading
  const [users, setUsers] = useState<UserType[]>(null); // loading
  // why the roles could not be read; set only while no roles are shown
  const [rolesError, setRolesError] = useState<unknown>(null);
  // Roles are changed only by users who may manage the roles of this object.
  const canEditOwners = !!hasObjectPermission?.(
    ACTION_PERMISSIONS.ansible.repository.manageRoles,
    item,
  );
  const [selectedGroup, setSelectedGroup] = useState<GroupType>(null);
  const [selectedUser, setSelectedUser] = useState<UserType>(null);
  const [showUserRemoveModal, setShowUserRemoveModal] =
    useState<UserType>(null);
  const [showUserSelectWizard, setShowUserSelectWizard] = useState<{
    user?: UserType;
    roles?: RoleType[];
  }>(null);
  const [showGroupRemoveModal, setShowGroupRemoveModal] =
    useState<GroupType>(null);
  const [showGroupSelectWizard, setShowGroupSelectWizard] = useState<{
    group?: GroupType;
    roles?: RoleType[];
  }>(null);
  const [showRoleRemoveModal, setShowRoleRemoveModal] = useState<string>(null);
  const [showRoleSelectWizard, setShowRoleSelectWizard] = useState<{
    roles?: RoleType[];
  }>(null);

  // grows when the same user signs in again, so the roles are read again
  const epoch = useSessionEpoch();
  const firstEpoch = useRef(epoch);

  // quiet: the roles are shown already; read them again without the loading
  // state, which would close the dialogs of this tab
  const query = ({ quiet = false } = {}) => {
    if (!quiet) {
      setUsers(null);
      setGroups(null);
      setRolesError(null);
    }

    // TODO handle pagination
    AnsibleRepositoryAPI.listRoles(id, { page_size: 100 })
      .then(({ data: { roles } }) => {
        const { users, groups } = assignRoles(roles);

        setUsers(users as UserType[]);
        setGroups(groups as GroupType[]);
        setRolesError(null);
      })
      .catch((e) => {
        // The session ended: the tab keeps its spinner or its roles and reads
        // again after signing in, the sign-in dialog explains the failure.
        if (isSessionEnd(e)) {
          return;
        }

        // A read that follows a sign-in keeps the roles on screen and says
        // that it failed; a first read shows a failed state with Retry, never
        // an empty list of owners.
        if (quiet) {
          addAlert({
            title: t`Roles list could not be displayed.`,
            variant: 'danger',
            description: requestErrorDescription(e),
          });
        } else {
          setRolesError(e);
        }
      });
  };

  const updateRoles = ({ roles, alertSuccess, alertFailure, stateUpdate }) => {
    // A change refused because the session ended raises no alert and leaves
    // the dialog open with its selection, so it can be sent after signing in.
    let sessionEnded = false;
    Promise.all(roles)
      .then(() => {
        addAlert({
          title: alertSuccess,
          variant: 'success',
        });
        query();
      })
      .catch((e) => {
        if (isSessionEnd(e)) {
          sessionEnded = true;
          return;
        }
        addAlert({
          title: alertFailure,
          variant: 'danger',
          description: requestErrorDescription(e),
        });
      })
      .finally(() => {
        if (!sessionEnded) {
          updateProps(stateUpdate);
        }
      });
  };

  const addUser = (user, roles) => {
    const rolePromises = roles.map((role) =>
      AnsibleRepositoryAPI.addRole(id, {
        role: role.name,
        users: [user.username],
      }),
    );
    updateRoles({
      roles: rolePromises,
      alertSuccess: t`User "${user.username}" has been successfully added to "${name}".`,
      alertFailure: t`User "${user.username}" could not be added to "${name}".`,
      stateUpdate: { showUserSelectWizard: null },
    });
  };

  const removeUser = (user) => {
    const roles = user.object_roles.map((role) =>
      AnsibleRepositoryAPI.removeRole(id, {
        role,
        users: [user.username],
      }),
    );
    updateRoles({
      roles,
      alertSuccess: t`User "${user.username}" has been successfully removed from "${name}".`,
      alertFailure: t`User "${user.username}" could not be removed from "${name}".`,
      stateUpdate: { showUserRemoveModal: null },
    });
  };

  const addGroup = (group, roles) => {
    const rolePromises = roles.map((role) =>
      AnsibleRepositoryAPI.addRole(id, {
        role: role.name,
        groups: [group.name],
      }),
    );
    updateRoles({
      roles: rolePromises,
      alertSuccess: t`Group "${group.name}" has been successfully added to "${name}".`,
      alertFailure: t`Group "${group.name}" could not be added to "${name}".`,
      stateUpdate: { showGroupSelectWizard: null },
    });
  };

  const removeGroup = (group) => {
    const roles = group.object_roles.map((role) =>
      AnsibleRepositoryAPI.removeRole(id, {
        role,
        groups: [group.name],
      }),
    );
    updateRoles({
      roles,
      alertSuccess: t`Group "${group.name}" has been successfully removed from "${name}".`,
      alertFailure: t`Group "${group.name}" could not be removed from "${name}".`,
      stateUpdate: { showGroupRemoveModal: null },
    });
  };

  const addUserRole = (user, roles) => {
    const rolePromises = roles.map((role) =>
      AnsibleRepositoryAPI.addRole(id, {
        role: role.name,
        users: [user.username],
      }),
    );
    updateRoles({
      roles: rolePromises,
      alertSuccess: t`User "${user.username}" roles successfully updated in "${name}".`,
      alertFailure: t`User "${user.username}" roles could not be update in "${name}".`,
      stateUpdate: { showRoleSelectWizard: null },
    });
  };

  const removeUserRole = (role, user) => {
    const removedRole = AnsibleRepositoryAPI.removeRole(id, {
      role,
      users: [user.username],
    });
    updateRoles({
      roles: [removedRole],
      alertSuccess: t`User "${user.username}" roles successfully updated in "${name}".`,
      alertFailure: t`User "${user.username}" roles could not be update in "${name}".`,
      stateUpdate: { showRoleRemoveModal: null },
    });
  };

  const addRole = (group, roles) => {
    const rolePromises = roles.map((role) =>
      AnsibleRepositoryAPI.addRole(id, {
        role: role.name,
        groups: [group.name],
      }),
    );
    updateRoles({
      roles: rolePromises,
      alertSuccess: t`Group "${group.name}" roles successfully updated in "${name}".`,
      alertFailure: t`Group "${group.name}" roles could not be update in "${name}".`,
      stateUpdate: { showRoleSelectWizard: null },
    });
  };

  const removeRole = (role, group) => {
    const removedRole = AnsibleRepositoryAPI.removeRole(id, {
      role,
      groups: [group.name],
    });
    updateRoles({
      roles: [removedRole],
      alertSuccess: t`Group "${group.name}" roles successfully updated in "${name}".`,
      alertFailure: t`Group "${group.name}" roles could not be update in "${name}".`,
      stateUpdate: { showRoleRemoveModal: null },
    });
  };

  const updateProps = (props) => {
    Object.entries(props).forEach(([k, v]) => {
      switch (k) {
        case 'showUserRemoveModal':
          setShowUserRemoveModal(v as UserType);
          break;
        case 'showUserSelectWizard':
          setShowUserSelectWizard(v as { user?: UserType; roles?: RoleType[] });
          break;
        case 'showGroupRemoveModal':
          setShowGroupRemoveModal(v as GroupType);
          break;
        case 'showGroupSelectWizard':
          setShowGroupSelectWizard(
            v as { group?: GroupType; roles?: RoleType[] },
          );
          break;
        case 'showRoleRemoveModal':
          setShowRoleRemoveModal(v as string);
          break;
        case 'showRoleSelectWizard':
          setShowRoleSelectWizard(v as { roles?: RoleType[] });
          break;
        default:
          console.error('updateProps', k, v);
      }
    });
  };

  useEffect(() => query(), [item.pulp_href]);

  // the same user signed in again: read the roles once more, keeping dialogs
  useEffect(() => {
    if (epoch !== firstEpoch.current) {
      query({ quiet: true });
    }
  }, [epoch]);

  useEffect(() => {
    if (!users) {
      return;
    }

    if (!params?.user) {
      setSelectedUser(null);
      return;
    }

    // an answer to an earlier name is dropped
    let current = true;
    UserAPI.list({ username: params.user })
      .then(({ data: { results } }) => {
        if (!current) {
          return;
        }
        const found = results?.[0];
        setSelectedUser(
          found
            ? (users.find((u) => u.username === found.username) ?? null)
            : null,
        );
      })
      .catch((e) => {
        // after a session end the lookup runs again with the re-read roles
        if (!current || isSessionEnd(e)) {
          return;
        }
        addAlert({
          title: t`Users list could not be displayed.`,
          variant: 'danger',
          description: requestErrorDescription(e),
        });
      });

    return () => {
      current = false;
    };
  }, [params?.user, users]);

  useEffect(() => {
    if (!groups) {
      return;
    }

    if (!params?.group) {
      setSelectedGroup(null);
      return;
    }

    // an answer to an earlier name is dropped
    let current = true;
    GroupAPI.list({ name: params.group })
      .then(({ data: { results } }) => {
        if (!current) {
          return;
        }
        const found = results?.[0];
        setSelectedGroup(
          found ? (groups.find((g) => g.name === found.name) ?? null) : null,
        );
      })
      .catch((e) => {
        // after a session end the lookup runs again with the re-read roles
        if (!current || isSessionEnd(e)) {
          return;
        }
        addAlert({
          title: t`Groups list could not be displayed.`,
          variant: 'danger',
          description: requestErrorDescription(e),
        });
      });

    return () => {
      current = false;
    };
  }, [params?.group, groups]);

  if (rolesError) {
    return (
      <ListErrorState
        title={t`Roles list could not be displayed.`}
        message={requestErrorDescription(rolesError)}
        onRetry={() => query()}
      />
    );
  }

  return (
    <AccessTab
      addGroup={addGroup}
      addRole={addRole}
      addUser={addUser}
      addUserRole={addUserRole}
      canEditOwners={canEditOwners}
      group={selectedGroup}
      groups={groups}
      name={name}
      pulpObjectType='repositories/ansible/ansible'
      removeGroup={removeGroup}
      removeRole={removeRole}
      removeUser={removeUser}
      removeUserRole={removeUserRole}
      selectRolesMessage={t`The selected roles will be added to this specific Ansible repository.`}
      showGroupRemoveModal={showGroupRemoveModal}
      showGroupSelectWizard={showGroupSelectWizard}
      showRoleRemoveModal={showRoleRemoveModal}
      showRoleSelectWizard={showRoleSelectWizard}
      showUserRemoveModal={showUserRemoveModal}
      showUserSelectWizard={showUserSelectWizard}
      updateProps={updateProps}
      user={selectedUser}
      users={users}
      urlPrefix={formatPath(Paths.ansible.repository.detail, {
        name,
      })}
    />
  );
};
