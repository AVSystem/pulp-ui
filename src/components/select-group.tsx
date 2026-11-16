import { t } from '@lingui/core/macro';
import { Flex, FlexItem, Label } from '@patternfly/react-core';
import { Td } from '@patternfly/react-table';
import {
  type FunctionComponent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { GroupAPI, type GroupType } from 'src/api';
import {
  AppliedFilters,
  CompoundFilter,
  EmptyStateFilter,
  EmptyStateNoData,
  LoadingSpinner,
  PulpPagination,
  RadioRow,
  RoleListTable,
} from 'src/components';
import { useSessionEpoch } from 'src/user-context';
import { filterIsSet } from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import { ListErrorState } from './list-error-state';

interface IProps {
  assignedGroups: GroupType[];
  selectedGroup?: GroupType;
  updateGroup?: (group) => void;
}

export const SelectGroup: FunctionComponent<IProps> = ({
  assignedGroups,
  selectedGroup,
  updateGroup,
}) => {
  const [inputText, setInputText] = useState<string>('');
  const [groups, setGroups] = useState<GroupType[]>([]);
  const [groupsCount, setGroupsCount] = useState<number>(0);

  const [loading, setLoading] = useState<boolean>(true);
  // why the last read failed; the list is not drawn while it is set
  const [failure, setFailure] = useState<ReactNode | null>(null);
  const [localParams, setLocalParams] = useState({
    page: 1,
    page_size: 10,
  });

  // grows when the same user signs in again, so the list reads again
  const epoch = useSessionEpoch();
  const firstEpoch = useRef(epoch);
  // numbers the reads, so an answer that is no longer the latest is dropped
  const latestRead = useRef(0);

  useEffect(() => {
    queryGroups(false);
  }, [localParams]);

  useEffect(() => {
    if (epoch !== firstEpoch.current) {
      queryGroups(true);
    }
  }, [epoch]);

  // A quiet read keeps the rows on screen; the selection lives in the parent
  // and the filter text in this component, so neither is touched by a read.
  const queryGroups = (quiet: boolean) => {
    const read = ++latestRead.current;
    if (!quiet) {
      setLoading(true);
      setFailure(null);
    }
    GroupAPI.list(localParams)
      .then(({ data }) => {
        if (read === latestRead.current) {
          setGroups(data.results);
          setGroupsCount(data.count);
          setFailure(null);
          setLoading(false);
        }
      })
      .catch((e) => {
        // The session ended: the sign-in dialog explains it and the list
        // reads again after signing in. Any other failure is shown with a
        // way to read again, so the dialog never spins without an end.
        if (isSessionEnd(e) || read !== latestRead.current) {
          return;
        }
        setFailure(requestErrorDescription(e));
        setLoading(false);
      });
  };

  if (loading) {
    return (
      <div className='pulp-custom-wizard-layout pulp-loading-wizard'>
        <LoadingSpinner />
      </div>
    );
  }

  if (failure) {
    return (
      <div className='pulp-custom-wizard-layout'>
        <ListErrorState
          title={t`Groups list could not be displayed.`}
          message={failure}
          onRetry={() => queryGroups(false)}
        />
      </div>
    );
  }

  const isSelected = ({ name }) => selectedGroup?.name === name;

  const noData = groups.length === 0;

  if (noData && !filterIsSet(localParams, ['name__icontains'])) {
    return (
      <div className='pulp-custom-wizard-layout pulp-no-data'>
        <EmptyStateNoData
          title={t`No assignable groups.`}
          description={t`There are currently no groups that can be assigned ownership.`}
        />
      </div>
    );
  }

  const isAssigned = ({ name }) =>
    assignedGroups.some((group) => group.name === name);

  const tabHeader = {
    headers: [
      {
        title: '',
        type: 'none',
        id: 'expander',
      },
      {
        title: t`Group`,
        type: 'alpha',
        id: 'name',
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
            {selectedGroup ? (
              <FlexItem>
                <Flex>
                  <FlexItem>
                    <strong>{t`Selected group`}</strong>
                  </FlexItem>

                  <FlexItem flex={{ default: 'flex_1' }}>
                    <Flex>
                      <FlexItem
                        key={selectedGroup.name}
                        className='pulp-permission'
                      >
                        <Label>{selectedGroup.name}</Label>
                      </FlexItem>
                    </Flex>
                  </FlexItem>
                </Flex>
              </FlexItem>
            ) : null}

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
                    {groups.map((group, i) => (
                      <RadioRow
                        rowIndex={i}
                        key={group.name}
                        isSelected={isSelected(group)}
                        onSelect={() => updateGroup(group)}
                        isDisabled={isAssigned(group)}
                        data-cy={`GroupListTable-CheckboxRow-row-${group.name}`}
                      >
                        <Td>{group.name}</Td>
                      </RadioRow>
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
              count={groupsCount}
            />
          </FlexItem>
        )}
      </Flex>
    </div>
  );
};
