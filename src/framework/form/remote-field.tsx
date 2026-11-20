import { t } from '@lingui/core/macro';
import { Button, Skeleton } from '@patternfly/react-core';
import { useRef, useState } from 'react';
import { Spinner, Typeahead } from 'src/components';
import { remoteLookup } from 'src/entities/core/remote/client';
import type { RemoteBase } from 'src/entities/plugin/model';
import { useEntityList, useRemoteByHref } from 'src/entities/plugin/queries';
import type { RemoteEntity } from 'src/entities/plugin/remote';
import { isSessionEnd, requestErrorText } from 'src/utilities/request-error';
import { useSettled } from '../use-settled';

// How many remotes the field offers at a time; the text typed narrows them on
// the server.
const CHOICES = 20;

// How long typing pauses before the remotes are searched for the text.
const SEARCH_PAUSE_MS = 250;

interface Props {
  // The plugin's remotes, which the field offers.
  remotes: RemoteEntity<RemoteBase, never, never>;
  // The address of the remote that is chosen, or null for none.
  value: string | null;
  onChange: (href: string | null) => void;
  isDisabled: boolean;
}

// The choice of one of the plugin's remotes, searched for on the server by the
// text typed. Every text is a read of its own, so the answer to an earlier text
// can never be the list of a later one, and the list that was shown stays until
// the next one has arrived. The chosen remote is named by its address through
// the list of every remote, so it keeps its name while a search lists others and
// when it is a remote of a type the plugin has no list for.
export const RemoteField = ({
  remotes,
  value,
  onChange,
  isDisabled,
}: Props) => {
  const [typed, setTyped] = useState('');
  const search = useSettled(typed.trim(), SEARCH_PAUSE_MS);
  const found = useEntityList(remotes, {
    ...(search ? { name__icontains: search } : {}),
    page_size: CHOICES,
    sort: 'name',
    fields: ['pulp_href', 'name'],
  });
  const chosen = useRemoteByHref(remoteLookup, value);

  const shown = useRef<{ name: string; pulp_href: string }[]>([]);
  if (found.data) {
    shown.current = found.data.results;
  }

  const failed =
    found.isError && !found.isFetching && !isSessionEnd(found.error);
  const name =
    chosen.data?.name ?? (chosen.isSuccess ? t`Not available` : null);

  return (
    <div data-cy='remote'>
      <Typeahead
        loadResults={setTyped}
        onClear={() => onChange(null)}
        onSelect={(_event, selected) => {
          const match = shown.current.find(
            (remote) => remote.name === selected,
          );
          if (match) {
            onChange(match.pulp_href);
          }
        }}
        placeholderText={t`Select a remote`}
        results={shown.current.map((remote) => ({
          name: remote.name,
          id: remote.pulp_href,
        }))}
        selections={value && name ? [{ name, id: value }] : []}
        isDisabled={isDisabled}
      />
      {found.isPending ? <Spinner size='sm' /> : null}
      {value && !name ? <Skeleton width='40%' /> : null}
      {failed ? (
        <span
          style={{
            color: 'var(--pf-t--global--text--color--status--danger--default)',
          }}
        >
          {t`Failed to load remotes: ${requestErrorText(found.error)}`}{' '}
          <Button variant='link' isInline onClick={() => void found.refetch()}>
            {t`Retry`}
          </Button>
        </span>
      ) : null}
    </div>
  );
};
