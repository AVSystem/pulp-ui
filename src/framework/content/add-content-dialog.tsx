import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import {
  Button,
  Content,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import { useId, useRef, useState } from 'react';
import {
  type AlertType,
  EmptyStateNoData,
  LoadingSpinner,
  Spinner,
  Typeahead,
} from 'src/components';
import { versionNumberOf } from 'src/entities/href';
import type { RepositoryBase } from 'src/entities/plugin/model';
import {
  useEntityList,
  useModifyRepository,
  useRepositoryVersion,
} from 'src/entities/plugin/queries';
import {
  type ModifyBody,
  addContentBody,
} from 'src/entities/plugin/repository';
import { handleDialogWriteError } from 'src/utilities/fail-alerts';
import { isSessionEnd, requestErrorText } from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';
import type { ContentTypeDef, repositoryOf } from '../descriptor';
import { ContentList, tabConfig } from '../detail/content-tab';
import { useSettled } from '../use-settled';
import { useWatchTask } from '../watched-tasks';

// How many repositories the field offers at a time; the text typed narrows them
// on the server.
const CHOICES = 20;

// How long typing pauses before the repositories are searched for the text.
const SEARCH_PAUSE_MS = 250;

const DIGITS = /^(0|[1-9][0-9]*)$/;

type Entity = ReturnType<typeof repositoryOf>['entity'];

// A repository of the plugin the content is taken from, as far as the choice
// needs it.
interface Source {
  pulp_href: string;
  name: string;
  latest_version_href?: string | null;
}

interface Props {
  // The repository that gets the content.
  repository: RepositoryBase;
  // The plugin's repository entity: it lists the repositories to choose from
  // and changes the repository's content.
  entity: Entity;
  // The kinds of content the plugin's repositories hold.
  types: readonly ContentTypeDef[];
  addAlert: (alert: AlertType) => void;
  onClose: () => void;
}

// The content of one version of another repository of the plugin, to tick and
// add to this repository. The server checks that the units exist and not who
// may read them, so the choice offers only the repositories the user can read
// through the plugin's own repository list; no other repository and no other
// plugin can be reached from here.
export const AddContentDialog = ({
  repository,
  entity,
  types,
  addAlert,
  onClose,
}: Props) => {
  const modify = useModifyRepository<ModifyBody>(entity);
  const { watch } = useWatchTask();
  const labelId = useId();
  const sending = useRef(false);
  const repositoryName = repository.name;

  const [typed, setTyped] = useState('');
  const search = useSettled(typed.trim(), SEARCH_PAUSE_MS);
  const [source, setSource] = useState<Source | null>(null);
  const [number, setNumber] = useState('');
  const [typeId, setTypeId] = useState(types[0]?.id);
  const type = types.find(({ id }) => id === typeId) ?? types[0];

  const found = useEntityList(entity, {
    ...(search ? { name__icontains: search } : {}),
    page_size: CHOICES,
    sort: 'name',
    fields: ['pulp_href', 'name', 'latest_version_href'],
  });
  // The list that was shown stays until the next one has arrived.
  const shown = useRef<Source[]>([]);
  if (found.data) {
    shown.current = found.data.results;
  }
  const choices = shown.current.filter(
    ({ pulp_href }) => pulp_href !== repository.pulp_href,
  );
  const failed =
    found.isError && !found.isFetching && !isSessionEnd(found.error);

  const choose = (next: Source | null) => {
    setSource(next);
    const latest = versionNumberOf(next?.latest_version_href);
    setNumber(latest === null ? '' : String(latest));
  };

  async function add(hrefs: readonly string[], clear: () => void) {
    if (sending.current) {
      return;
    }
    sending.current = true;
    try {
      const task = await modify.mutateAsync({
        href: repository.pulp_href,
        body: addContentBody(hrefs),
      });
      // The root follows the task to its end wherever the user is by then; the
      // repository and its content are read again then.
      watch({
        href: task,
        label: t`Addition of content to ${repositoryName}`,
        resource: {
          app: entity.app,
          object: entity.object,
          href: repository.pulp_href,
        },
      });
      addAlert(
        taskAlert(
          task,
          t`Addition started for repository "${repositoryName}".`,
        ),
      );
      clear();
      onClose();
    } catch (error) {
      handleDialogWriteError(
        t`Failed to add content to repository "${repositoryName}"`,
        onClose,
        addAlert,
      )(error);
    } finally {
      sending.current = false;
    }
  }

  const latest = versionNumberOf(source?.latest_version_href);
  const wanted = DIGITS.test(number.trim()) ? Number(number.trim()) : null;

  return (
    <Modal aria-labelledby={labelId} isOpen onClose={onClose} variant='large'>
      <ModalHeader labelId={labelId} title={t`Add content`} />
      <ModalBody>
        <Content component='p'>
          {t`Choose a repository and a version of it, then tick the content to copy into "${repositoryName}". The repository gets a new latest version that holds the content it has now and the content you add.`}
        </Content>
        <FormGroup label={t`Repository to take content from`} fieldId='source'>
          <div data-cy='source'>
            <Typeahead
              loadResults={setTyped}
              onClear={() => choose(null)}
              onSelect={(_event, selected) => {
                const match = choices.find(({ name }) => name === selected);
                if (match) {
                  choose(match);
                }
              }}
              placeholderText={t`Select a repository`}
              results={choices.map(({ name, pulp_href }) => ({
                name,
                id: pulp_href,
              }))}
              selections={
                source ? [{ name: source.name, id: source.pulp_href }] : []
              }
            />
            {found.isPending ? <Spinner size='sm' /> : null}
            {failed ? (
              <span>
                {t`Failed to load repositories: ${requestErrorText(found.error)}`}{' '}
                <Button
                  variant='link'
                  isInline
                  onClick={() => void found.refetch()}
                >
                  {t`Retry`}
                </Button>
              </span>
            ) : null}
          </div>
        </FormGroup>
        {source && latest === null ? (
          <Content component='p'>{t`This repository has no version.`}</Content>
        ) : null}
        {source && latest !== null ? (
          <>
            <FormGroup label={t`Version`} fieldId='source-version'>
              <TextInput
                id='source-version'
                type='number'
                min={0}
                aria-label={t`Version`}
                value={number}
                onChange={(_event, value) => setNumber(value)}
                style={{ maxWidth: '10rem' }}
              />
            </FormGroup>
            {types.length > 1 ? (
              <ToggleGroup aria-label={t`Content type`}>
                {types.map(({ id, label }) => (
                  <ToggleGroupItem
                    key={id}
                    text={i18n._(label)}
                    buttonId={`add-content-type-${id}`}
                    isSelected={id === type.id}
                    onChange={() => setTypeId(id)}
                  />
                ))}
              </ToggleGroup>
            ) : null}
            {wanted === null ? (
              <Content component='p'>
                {t`Enter the number of a version of "${source.name}".`}
              </Content>
            ) : (
              <Browser
                key={`${source.pulp_href}|${wanted}|${type.id}`}
                entity={entity}
                source={source}
                number={wanted}
                type={type}
                isAdding={modify.isPending}
                onAdd={add}
              />
            )}
          </>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button key='close' variant='link' onClick={onClose}>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

interface BrowserProps {
  entity: Entity;
  source: Source;
  number: number;
  type: ContentTypeDef;
  isAdding: boolean;
  onAdd: (hrefs: readonly string[], clear: () => void) => void;
}

// The content of one version of the source, found by its number, with the
// check boxes of the page and the one action that adds what is ticked.
const Browser = ({
  entity,
  source,
  number,
  type,
  isAdding,
  onAdd,
}: BrowserProps) => {
  const query = useRepositoryVersion(entity, source.pulp_href, number);
  const [search, setSearch] = useState('');
  const version = query.data;
  const name = source.name;

  if (version === null) {
    return (
      <EmptyStateNoData
        title={t`This repository has no version ${number}.`}
        description={t`Enter the number of a version of "${name}".`}
      />
    );
  }
  if (!version) {
    return query.isError && !isSessionEnd(query.error) && !query.isFetching ? (
      <Content component='p'>
        {t`The version could not be read: ${requestErrorText(query.error)}`}{' '}
        <Button variant='link' isInline onClick={() => void query.refetch()}>
          {t`Retry`}
        </Button>
      </Content>
    ) : (
      <LoadingSpinner />
    );
  }

  return (
    <ContentList
      config={tabConfig(type)}
      version={version.pulp_href}
      address={{ search, onChange: setSearch }}
      selecting={{
        actions: (picked, clear) => (
          <Button
            variant='primary'
            isDisabled={picked.length === 0 || isAdding}
            onClick={() =>
              onAdd(
                picked.map((row) => row.pulp_href),
                clear,
              )
            }
          >
            {plural(picked.length, {
              one: 'Add # item',
              other: 'Add # items',
            })}
            {isAdding && <Spinner size='sm' />}
          </Button>
        ),
      }}
    />
  );
};
