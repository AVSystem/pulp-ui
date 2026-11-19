import { t } from '@lingui/core/macro';
import { Flex, FlexItem, Label } from '@patternfly/react-core';
import { Td } from '@patternfly/react-table';
import { type FunctionComponent, useState } from 'react';
import { type Role } from 'src/entities/core/role/model';
import { useRoles } from 'src/entities/core/role/queries';
import { filterIsSet, translateLockedRole } from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import { AppliedFilters } from './applied-filters';
import { CompoundFilter } from './compound-filter';
import { EmptyStateFilter } from './empty-state-filter';
import { EmptyStateNoData } from './empty-state-no-data';
import { ListErrorState } from './list-error-state';
import { LoadingSpinner } from './loading-spinner';
import { PulpPagination } from './pulp-pagination';
import { CheckboxRow, RoleListTable } from './role-list-table';

interface RoleSelectorProps {
  // the roles the target holds already: shown ticked and not selectable
  assignedRoles: { role: string }[];
  selectedRoles: Role[];
  onRolesUpdate?: (roles: Role[]) => void;
  message?: string;
  // the kind of object the roles are for, as the path of its endpoint below
  // the API root; only roles that fit it are offered
  pulpObjectType?: string;
}

// The role picker of a screen that reads through the data hooks, as a step of a
// dialog: the roles come from the role list with a name filter and paging, the
// parent owns which are ticked. Screens that still read through the legacy
// client use SelectRoles.
export const RoleSelector: FunctionComponent<RoleSelectorProps> = ({
  assignedRoles,
  selectedRoles,
  onRolesUpdate,
  message,
  pulpObjectType,
}) => {
  const [inputText, setInputText] = useState<string>('');
  const [localParams, setLocalParams] = useState<{
    page: number;
    page_size: number;
    sort: string;
    name__icontains?: string;
  }>({
    page: 1,
    page_size: 10,
    sort: 'name',
  });

  // Every set of parameters is a read of its own, so an answer that is no
  // longer the latest is never shown. The filter text lives here and the
  // selection in the parent, so a read touches neither.
  const query = useRoles({ ...localParams, object_type: pulpObjectType });
  const roles = query.data?.results;
  const rolesItemCount = query.data?.count ?? 0;

  if (!roles) {
    // The session ended: the sign-in dialog explains it and the list reads
    // again after signing in. Any other failure is shown with a way to read
    // again, so the dialog never spins without an end.
    if (query.isError && !isSessionEnd(query.error) && !query.isFetching) {
      return (
        <div className='pulp-custom-wizard-layout'>
          <ListErrorState
            title={t`Roles list could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </div>
      );
    }

    return (
      <div className='pulp-custom-wizard-layout pulp-loading-wizard'>
        <LoadingSpinner />
      </div>
    );
  }

  const isRoleSelected = (name) =>
    selectedRoles.map((r) => r.name).includes(name);

  const noData = roles.length === 0;

  if (noData && !filterIsSet(localParams, ['name__icontains'])) {
    return (
      <div className='pulp-custom-wizard-layout pulp-no-data'>
        <EmptyStateNoData
          title={t`No assignable roles.`}
          description={t`There are currently no roles that can be assigned to this group.`}
        />
      </div>
    );
  }

  const isAssigned = (name) => assignedRoles.some((role) => role.role === name);

  const tabHeader = {
    headers: [
      {
        title: '',
        type: 'none',
        id: 'expander',
      },
      {
        title: t`Role`,
        type: 'alpha',
        id: 'name',
      },
      {
        title: t`Description`,
        type: 'none',
        id: 'description',
      },
    ],
  };

  return (
    <div className='pulp-custom-wizard-layout'>
      <Flex
        justifyContent={{
          default: noData
            ? 'justifyContentFlexStart'
            : 'justifyContentSpaceBetween',
        }}
        direction={{ default: 'column' }}
      >
        <FlexItem className='pulp-select-roles-content'>
          <Flex
            justifyContent={{
              default: noData
                ? 'justifyContentFlexStart'
                : 'justifyContentSpaceBetween',
            }}
            direction={{ default: 'column' }}
          >
            {message && (
              <FlexItem>
                <Flex>
                  <FlexItem>{message}</FlexItem>
                </Flex>
              </FlexItem>
            )}

            {Object.keys(selectedRoles).length !== 0 && (
              <FlexItem>
                <Flex>
                  <FlexItem>
                    <strong>{t`Selected roles`}</strong>
                  </FlexItem>

                  <FlexItem flex={{ default: 'flex_1' }}>
                    <Flex>
                      {selectedRoles.map((role) => (
                        <FlexItem
                          key={role.name}
                          className='pulp-permission'
                          data-cy={`PulpPermission-${role.name}`}
                        >
                          <Label
                            onClose={() =>
                              onRolesUpdate(
                                selectedRoles.filter(
                                  (r) => r.name !== role.name,
                                ),
                              )
                            }
                          >
                            {role.name}
                          </Label>
                        </FlexItem>
                      ))}
                    </Flex>
                  </FlexItem>
                </Flex>
              </FlexItem>
            )}

            <FlexItem>
              <div className='pulp-filter'>
                <CompoundFilter
                  inputText={inputText}
                  onChange={(inputText) => setInputText(inputText)}
                  params={localParams}
                  updateParams={(p) => setLocalParams(p)}
                  filterConfig={[
                    {
                      id: 'name__icontains',
                      title: t`Name`,
                    },
                  ]}
                />
              </div>

              <AppliedFilters
                updateParams={(p) => {
                  setLocalParams(p);
                  setInputText('');
                }}
                params={localParams}
                niceNames={{ name__icontains: t`Name` }}
                ignoredParams={['sort', 'page_size', 'page']}
                style={{ marginTop: '8px' }}
              />
            </FlexItem>

            <FlexItem style={{ flexGrow: 1 }}>
              {noData && filterIsSet(localParams, ['name__icontains']) ? (
                <div className='pulp-no-filter-data'>
                  <EmptyStateFilter />
                </div>
              ) : (
                <div className='pulp-selected-roles-list'>
                  <RoleListTable
                    isStickyHeader
                    params={localParams}
                    updateParams={(p) => {
                      setLocalParams(p);
                    }}
                    tableHeader={tabHeader}
                  >
                    {roles.map((role, i) => (
                      <CheckboxRow
                        rowIndex={i}
                        key={role.name}
                        isSelected={
                          isRoleSelected(role.name) || isAssigned(role.name)
                        }
                        onSelect={() =>
                          onRolesUpdate(
                            isRoleSelected(role.name)
                              ? selectedRoles.filter(
                                  (r) => r.name !== role.name,
                                )
                              : [...selectedRoles, role],
                          )
                        }
                        isDisabled={isAssigned(role.name)}
                        data-cy={`RoleListTable-CheckboxRow-row-${role.name}`}
                      >
                        <Td>{role.name}</Td>
                        <Td>
                          {translateLockedRole(role.name, role.description)}
                        </Td>
                      </CheckboxRow>
                    ))}
                  </RoleListTable>
                </div>
              )}
            </FlexItem>
          </Flex>
        </FlexItem>

        {!noData && (
          <FlexItem>
            <PulpPagination
              params={localParams}
              updateParams={(p) => setLocalParams(p)}
              count={rolesItemCount}
            />
          </FlexItem>
        )}
      </Flex>
    </div>
  );
};
