import { t } from '@lingui/core/macro';
import { Button, Skeleton } from '@patternfly/react-core';
import { useRef, useState } from 'react';
import { FormFieldHelper, Spinner, Typeahead } from 'src/components';
import { guardKindOf } from 'src/entities/core/content-guard/client';
import {
  useContentGuardNames,
  useContentGuardSearch,
} from 'src/entities/core/content-guard/queries';
import { isSessionEnd, requestErrorText } from 'src/utilities/request-error';
import { useSettled } from '../use-settled';

// How long typing pauses before the guards are searched for the text.
const SEARCH_PAUSE_MS = 250;

// What a guard is, in words, from the kind in its address. A kind this screen
// has no word for is shown as the server names it, so a new type of guard is
// never hidden or mislabeled.
export function guardTypeLabel(href: string): string {
  const kind = guardKindOf(href);

  switch (kind) {
    case 'rbac':
      return t`RBAC`;
    case 'x509':
      return t`X.509 certificate`;
    case 'rhsm':
      return t`RHSM certificate`;
    case 'header':
      return t`Header`;
    case 'composite':
      return t`Composite`;
    default:
      return kind ?? '';
  }
}

interface Props {
  // The address of the guard that is chosen, or null for none.
  value: string | null;
  onChange: (href: string | null) => void;
  isDisabled?: boolean;
}

// The choice of one content guard, searched for on the server by the text
// typed. It asks for at most 20 guards at a time and says when more match: the
// whole list is never loaded, however many guards the server has. Every text is
// a read of its own and the list that was shown stays until the next has
// arrived. A chosen guard the user may not read is shown as such, not as a
// blank.
export const GuardField = ({ value, onChange, isDisabled }: Props) => {
  const [typed, setTyped] = useState('');
  const search = useSettled(typed.trim(), SEARCH_PAUSE_MS);
  const found = useContentGuardSearch(search);
  const known = useContentGuardNames(value ? [value] : []);

  // The guards listed last, so the list does not empty while the next text is
  // read, and the guard that was just picked, so its name is shown without a
  // second read.
  const shown = useRef<{ pulp_href: string; name: string }[]>([]);
  const picked = useRef<{ href: string; name: string } | null>(null);
  if (found.data) {
    shown.current = found.data.results;
  }

  const failed =
    found.isError && !found.isFetching && !isSessionEnd(found.error);
  const name = !value
    ? null
    : picked.current?.href === value
      ? picked.current.name
      : (known.names.get(value) ??
        (known.pending ? null : t`A content guard you may not see`));
  const more =
    found.data !== undefined && found.data.count > shown.current.length;

  return (
    <div data-cy='content-guard'>
      <Typeahead
        loadResults={setTyped}
        onClear={() => {
          picked.current = null;
          onChange(null);
        }}
        onSelect={(_event, selected) => {
          const match = shown.current.find((guard) => guard.name === selected);
          if (match) {
            picked.current = { href: match.pulp_href, name: match.name };
            onChange(match.pulp_href);
          }
        }}
        placeholderText={t`Select a content guard`}
        results={shown.current.map((guard) => ({
          name: guard.name,
          id: guard.pulp_href,
          description: guardTypeLabel(guard.pulp_href),
        }))}
        selections={value && name ? [{ name, id: value }] : []}
        isDisabled={isDisabled}
      />
      {found.isPending ? <Spinner size='sm' /> : null}
      {value && !name ? <Skeleton width='40%' /> : null}
      {more ? (
        <FormFieldHelper>
          {t`More guards match; type more of the name`}
        </FormFieldHelper>
      ) : null}
      {failed ? (
        <span
          style={{
            color: 'var(--pf-t--global--text--color--status--danger--default)',
          }}
        >
          {t`Failed to load content guards: ${requestErrorText(found.error)}`}{' '}
          <Button variant='link' isInline onClick={() => void found.refetch()}>
            {t`Retry`}
          </Button>
        </span>
      ) : null}
    </div>
  );
};
