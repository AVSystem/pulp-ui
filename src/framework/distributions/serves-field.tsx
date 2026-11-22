import { t } from '@lingui/core/macro';
import {
  Button,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Radio,
  Skeleton,
} from '@patternfly/react-core';
import { useRef, useState } from 'react';
import { FormFieldHelper, Spinner, Typeahead } from 'src/components';
import { useRepositorySearch } from 'src/entities/core/repository/queries';
import { versionNumberOf } from 'src/entities/href';
import type { DistributionBinding } from 'src/entities/plugin/distribution';
import { repositoryOfPublication } from 'src/entities/plugin/publication';
import { useEntityList } from 'src/entities/plugin/queries';
import { isSessionEnd, requestErrorText } from 'src/utilities/request-error';
import type { PluginDescriptor } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import { useSettled } from '../use-settled';

// What a distribution serves, as the form holds it. A repository is chosen
// first; for a plugin that serves from publications the user then decides
// whether the distribution follows the repository or stays on one publication
// of it. A distribution bound to one repository version keeps that binding
// (`version`) until the user chooses another; the form never makes one.
export interface ServesChoice {
  mode: 'repository' | 'publication' | 'version';
  repository: { href: string; name: string } | null;
  // the address of the publication, for the mode `publication`
  publication: string | null;
}

export const NO_SERVES: ServesChoice = {
  mode: 'repository',
  repository: null,
  publication: null,
};

// The one thing the choice says to serve, or null when it is not complete or
// is the version binding the distribution already has.
export function servesBinding(
  choice: ServesChoice,
): DistributionBinding | null {
  if (choice.mode === 'repository' && choice.repository) {
    return { repository: choice.repository.href };
  }
  if (choice.mode === 'publication' && choice.publication) {
    return { publication: choice.publication };
  }
  return null;
}

// Whether the choice names what to serve: the kept version binding counts.
export function servesComplete(choice: ServesChoice): boolean {
  return choice.mode === 'version' || servesBinding(choice) !== null;
}

// How many repositories one search offers and how long typing pauses before
// the text is searched for.
const SEARCH_PAUSE_MS = 250;

// How many publications of the repository the choice lists, newest first.
const PUBLICATION_CHOICES = 50;

const PUBLICATION_FIELDS = [
  'pulp_href',
  'repository',
  'repository_version',
  'pulp_created',
];

interface RepositoryFieldProps {
  plugin: FrameworkPlugin;
  value: ServesChoice['repository'];
  onChange: (repository: ServesChoice['repository']) => void;
  isDisabled?: boolean;
}

// The choice of one of the plugin's repositories, searched for on the server
// by the text typed. Every text is a read of its own and the list that was
// shown stays until the next has arrived.
const RepositoryField = ({
  plugin,
  value,
  onChange,
  isDisabled,
}: RepositoryFieldProps) => {
  const [typed, setTyped] = useState('');
  const search = useSettled(typed.trim(), SEARCH_PAUSE_MS);
  const found = useRepositorySearch(plugin, search);
  const shown = useRef<{ name: string; pulp_href: string }[]>([]);
  if (found.data) {
    shown.current = found.data.results;
  }
  const failed =
    found.isError && !found.isFetching && !isSessionEnd(found.error);
  const more =
    found.data !== undefined && found.data.count > shown.current.length;

  return (
    <div data-cy='repository'>
      <Typeahead
        loadResults={setTyped}
        onClear={() => onChange(null)}
        onSelect={(_event, selected) => {
          const match = shown.current.find(
            (repository) => repository.name === selected,
          );
          if (match) {
            onChange({ href: match.pulp_href, name: match.name });
          }
        }}
        placeholderText={t`Select a repository`}
        results={shown.current.map((repository) => ({
          name: repository.name,
          id: repository.pulp_href,
        }))}
        selections={value ? [{ name: value.name, id: value.href }] : []}
        isDisabled={isDisabled}
      />
      {found.isPending ? <Spinner size='sm' /> : null}
      {more ? (
        <FormFieldHelper>
          {t`More repositories match; type more of the name`}
        </FormFieldHelper>
      ) : null}
      {failed ? (
        <span
          style={{
            color: 'var(--pf-t--global--text--color--status--danger--default)',
          }}
        >
          {t`Failed to load repositories: ${requestErrorText(found.error)}`}{' '}
          <Button variant='link' isInline onClick={() => void found.refetch()}>
            {t`Retry`}
          </Button>
        </span>
      ) : null}
    </div>
  );
};

interface PublicationFieldProps {
  descriptor: PluginDescriptor;
  repository: string;
  value: string | null;
  onChange: (publication: string | null) => void;
  isDisabled?: boolean;
}

// The publications of the chosen repository, newest first, to pick one from.
const PublicationField = ({
  descriptor,
  repository,
  value,
  onChange,
  isDisabled,
}: PublicationFieldProps) => {
  const entity = (
    descriptor.publication as NonNullable<PluginDescriptor['publication']>
  ).entity;
  const read = useEntityList(entity, {
    repository,
    sort: '-pulp_created',
    page_size: PUBLICATION_CHOICES,
    fields: PUBLICATION_FIELDS,
  });
  const failed = read.isError && !read.isFetching && !isSessionEnd(read.error);
  // The server's filter is not trusted: a publication of another repository is
  // never offered.
  const rows = (read.data?.results ?? []).filter(
    (row) => repositoryOfPublication(row) === repository,
  );
  const more = read.data !== undefined && read.data.count > rows.length;

  return (
    <FormGroup label={t`Publication`} fieldId='publication' isRequired>
      <FormSelect
        id='publication'
        value={value ?? ''}
        isDisabled={isDisabled || read.isPending}
        onChange={(_event, next) => onChange(next === '' ? null : next)}
      >
        <FormSelectOption
          value=''
          label={
            read.isPending
              ? t`Loading publications`
              : rows.length === 0
                ? t`This repository has no publication`
                : t`Choose a publication`
          }
        />
        {rows.map((row) => {
          const version = versionNumberOf(row.repository_version);
          const created = row.pulp_created
            ? new Date(row.pulp_created).toLocaleString()
            : '';

          return (
            <FormSelectOption
              key={row.pulp_href}
              value={row.pulp_href}
              label={
                version === null
                  ? t`Publication made ${created}`
                  : t`Version ${version}, made ${created}`
              }
            />
          );
        })}
      </FormSelect>
      {more ? (
        <FormFieldHelper>
          {t`Only the newest ${rows.length} publications are listed.`}
        </FormFieldHelper>
      ) : null}
      {failed ? (
        <span
          style={{
            color: 'var(--pf-t--global--text--color--status--danger--default)',
          }}
        >
          {t`Failed to load publications: ${requestErrorText(read.error)}`}{' '}
          <Button variant='link' isInline onClick={() => void read.refetch()}>
            {t`Retry`}
          </Button>
        </span>
      ) : null}
    </FormGroup>
  );
};

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  value: ServesChoice;
  onChange: (value: ServesChoice) => void;
  // The repository is given by the screen the form was opened from and cannot
  // be changed here. `found` is null while it is read and false when the
  // repository does not exist or may not be seen.
  locked?: { name: string; found: boolean | null };
  // The number of the repository version the distribution is bound to now,
  // when it is bound to one (null when its number is not known): the choice
  // to keep it is offered beside the others.
  keptVersion?: number | null;
  // The server's refusal of the repository or the publication.
  error?: string;
  isDisabled?: boolean;
}

// The part of a distribution form that says what the distribution serves: the
// repository, and for a plugin that serves from publications whether it follows
// the repository's newest publication or one publication of it. A plugin that
// serves versions directly offers the repository only.
export const ServesField = ({
  plugin,
  descriptor,
  value,
  onChange,
  locked,
  keptVersion,
  error,
  isDisabled,
}: Props) => {
  const fromPublication =
    descriptor.publication?.servesFromPublication ?? false;
  const hasVersion = keptVersion !== undefined;
  const choices = fromPublication || hasVersion;
  const repository = value.repository;

  return (
    <>
      {choices ? (
        <FormGroup
          fieldId='serves'
          role='radiogroup'
          isStack
          isRequired
          label={t`Serves`}
        >
          {hasVersion ? (
            <Radio
              id='serves_version'
              name='serves'
              label={
                keptVersion === null
                  ? t`The repository version it serves now`
                  : t`Repository version ${keptVersion}, as it is now`
              }
              isChecked={value.mode === 'version'}
              isDisabled={isDisabled}
              onChange={() => onChange({ ...value, mode: 'version' })}
            />
          ) : null}
          <Radio
            id='serves_repository'
            name='serves'
            label={
              fromPublication
                ? t`The repository (serves its newest publication)`
                : t`The repository (serves its latest version)`
            }
            isChecked={value.mode === 'repository'}
            isDisabled={isDisabled}
            onChange={() =>
              onChange({ ...value, mode: 'repository', publication: null })
            }
          />
          {fromPublication ? (
            <Radio
              id='serves_publication'
              name='serves'
              label={t`One publication`}
              description={t`It serves that publication until you change it.`}
              isChecked={value.mode === 'publication'}
              isDisabled={isDisabled}
              onChange={() =>
                onChange({ ...value, mode: 'publication', publication: null })
              }
            />
          ) : null}
        </FormGroup>
      ) : null}
      {value.mode === 'version' ? null : (
        <FormGroup label={t`Repository`} fieldId='repository' isRequired>
          {locked ? (
            locked.found === null ? (
              <Skeleton width='40%' />
            ) : locked.found ? (
              <p data-cy='repository-locked'>{locked.name}</p>
            ) : (
              <FormFieldHelper variant='error'>
                {t`There is no repository named "${locked.name}", or you may not see it.`}
              </FormFieldHelper>
            )
          ) : (
            <RepositoryField
              plugin={plugin}
              value={repository}
              isDisabled={isDisabled}
              onChange={(next) =>
                onChange({ ...value, repository: next, publication: null })
              }
            />
          )}
          {!choices ? (
            <FormFieldHelper>
              {t`Clients get the latest version of this repository.`}
            </FormFieldHelper>
          ) : null}
        </FormGroup>
      )}
      {value.mode === 'publication' && repository ? (
        <PublicationField
          descriptor={descriptor}
          repository={repository.href}
          value={value.publication}
          isDisabled={isDisabled}
          onChange={(publication) => onChange({ ...value, publication })}
        />
      ) : null}
      {error ? (
        <FormFieldHelper variant='error'>{error}</FormFieldHelper>
      ) : null}
    </>
  );
};
