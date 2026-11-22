import { t } from '@lingui/core/macro';
import { Label } from '@patternfly/react-core';
import { Tooltip } from 'src/components';
import type { ServedState } from './served-state';

// Why a distribution cannot be checked, in words for the person who sees the
// label.
function reasonText(reason: ServedState['reason']): string {
  return reason === 'too-many'
    ? t`Too many publications to check here.`
    : t`You may not read the publications of this plugin, so it cannot be told here whether this distribution serves content.`;
}

// What a distribution serves, next to its URL. Only a state worth a second look
// draws anything: a distribution that is served, and one the rules do not apply
// to, show nothing, so a warning stands out where there is one.
export const ServedLabel = ({ state }: { state: ServedState }) => {
  switch (state.state) {
    case 'no-publication':
      return (
        <Label color='orange'>{t`Serves nothing (404): no publication`}</Label>
      );
    case 'unbound':
      return <Label color='orange'>{t`Not bound to anything`}</Label>;
    case 'stale': {
      const served = state.servedVersion;
      const latest = state.latestVersion;
      return (
        <Label color='orange'>{t`Serves version ${served}, latest is ${latest}`}</Label>
      );
    }
    case 'cannot-check':
      return (
        <Tooltip content={reasonText(state.reason)}>
          <span tabIndex={0}>
            <Label variant='outline'>{t`Cannot be checked`}</Label>
          </span>
        </Tooltip>
      );
    default:
      return state.note === 'deprecated-publication' ? (
        <Label variant='outline'>{t`Bound to a deprecated publication`}</Label>
      ) : null;
  }
};
