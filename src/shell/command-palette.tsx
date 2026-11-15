import { plural, t } from '@lingui/core/macro';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  TextInputGroup,
  TextInputGroupMain,
  Title,
} from '@patternfly/react-core';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';
import menuStyles from '@patternfly/react-styles/css/components/Menu/menu.mjs';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { GenericRepositoryAPI } from 'src/api/generic-pulp';
import { Spinner } from 'src/components';
import { useMenuModel } from 'src/menu';
import { Paths, formatPath } from 'src/paths';
import { usePlugins } from 'src/plugins';
import { useUserContext } from 'src/user-context';

// The most screens the palette lists.
const SCREEN_LIMIT = 8;

// A search needs at least this many characters and starts this long after the
// last keystroke.
const MIN_REPOSITORY_QUERY = 2;
const DEBOUNCE_MS = 250;

// How many repositories of one type the palette lists, and how many the one
// request asks for, so that several types can be represented in the answer.
const REPOSITORIES_PER_TYPE = 5;
const REPOSITORY_REQUEST_SIZE = 50;

const TRIGGER_ID = 'pulp-palette-trigger';
const INPUT_ID = 'pulp-palette-input';

// A dialog that is open anywhere on the page.
const DIALOG_SELECTOR = '.pf-v6-c-modal-box';

// Whether the shortcut is Cmd+K: on Apple platforms. The shortcut itself works
// with either modifier everywhere.
function isApplePlatform(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// One line of the result list: where choosing it leads, the name on the left
// and, for a repository, the plugin it belongs to in the right column.
interface IResult {
  id: string;
  name: string;
  path: string;
  plugin?: string;
}

interface IGroup {
  id: string;
  title: string;
  results: IResult[];
  // What the group's own line below its results says about the search.
  status?: 'loading' | 'failed' | 'refused';
}

interface IRepositoryRow {
  pulp_href: string;
  name: string;
}

// The plugins whose repositories have a screen of their own: the name shown
// for the plugin and where a repository of it opens.
function repositoryScreens(): Record<
  string,
  { label: string; detail: string }
> {
  return {
    file: { label: t`File`, detail: Paths.file.repository.detail },
    deb: { label: 'deb', detail: Paths.deb.repository.detail },
    rpm: { label: 'RPM', detail: Paths.rpm.repository.detail },
    python: { label: 'Python', detail: Paths.python.repository.detail },
    ansible: { label: 'Ansible', detail: Paths.ansible.repository.detail },
  };
}

// The plugin and the type of a repository, which are the two segments of its
// address after "repositories", for example deb and apt.
function repositoryKind(href: string): { plugin: string; type: string } | null {
  const match = /\/repositories\/([^/]+)\/([^/]+)\//.exec(href);
  return match ? { plugin: match[1], type: match[2] } : null;
}

type RepositorySearch =
  | { state: 'off' }
  | { state: 'loading' }
  | { state: 'refused' }
  | { state: 'failed'; retry: () => void }
  | { state: 'ready'; repositories: IRepositoryRow[] };

type Answer =
  | { text: string; state: 'refused' | 'failed' }
  | { text: string; state: 'ready'; repositories: IRepositoryRow[] };

// Looks repositories up by name with one request to the list of all
// repositories, once the text has stopped changing. While the text is shorter
// than the minimum, or searching is not possible, nothing is asked. An answer
// to a text that is no longer the one typed is dropped.
function useRepositorySearch(text: string, enabled: boolean): RepositorySearch {
  const active = enabled && text.length >= MIN_REPOSITORY_QUERY;
  const [settled, setSettled] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!active) {
      setSettled('');
      return undefined;
    }
    const timer = setTimeout(() => setSettled(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, text]);

  useEffect(() => {
    if (!settled) {
      return undefined;
    }
    let stale = false;
    GenericRepositoryAPI.list({
      name__icontains: settled,
      page_size: REPOSITORY_REQUEST_SIZE,
    }).then(
      ({ data }) => {
        if (!stale) {
          setAnswer({
            text: settled,
            state: 'ready',
            repositories: Array.isArray(data?.results) ? data.results : [],
          });
        }
      },
      (error) => {
        if (!stale) {
          setAnswer({
            text: settled,
            state: error?.response?.status === 403 ? 'refused' : 'failed',
          });
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [settled, attempt]);

  if (!active) {
    return { state: 'off' };
  }
  if (answer?.text !== text) {
    return { state: 'loading' };
  }
  if (answer.state === 'ready') {
    return { state: 'ready', repositories: answer.repositories };
  }
  if (answer.state === 'refused') {
    return { state: 'refused' };
  }
  return {
    state: 'failed',
    retry: () => {
      setAnswer(null);
      setAttempt((count) => count + 1);
    },
  };
}

// The repositories of the installed plugins that have a repository screen, at
// most a few of each type, in the order the server listed them.
function repositoryResults(
  repositories: IRepositoryRow[],
  installed: ReadonlySet<string>,
): IResult[] {
  const screens = repositoryScreens();
  const perType = new Map<string, number>();
  const results: IResult[] = [];

  for (const repository of repositories) {
    const kind = repositoryKind(repository.pulp_href);
    const screen =
      kind && installed.has(kind.plugin) ? screens[kind.plugin] : null;
    if (!kind || !screen || typeof repository.name !== 'string') {
      continue;
    }
    const key = `${kind.plugin}/${kind.type}`;
    const count = perType.get(key) ?? 0;
    if (count >= REPOSITORIES_PER_TYPE) {
      continue;
    }
    perType.set(key, count + 1);
    results.push({
      id: `repository-${results.length}`,
      name: repository.name,
      plugin: screen.label,
      // Built from the route and the name, never from the address the
      // server sent.
      path: formatPath(screen.detail, { name: repository.name }),
    });
  }
  return results;
}

// Moves the highlight one step through a list of the given length, wrapping at
// both ends.
function step(index: number, delta: 1 | -1, length: number): number {
  return (index + delta + length) % length;
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { screens } = useMenuModel();
  const plugins = usePlugins();
  const { user } = useUserContext();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const text = query.trim();
  const needle = text.toLowerCase();

  // Repositories are looked up for a signed-in user once the installed plugins
  // are known, since only those plugins' repositories are listed.
  const installed = plugins?.state === 'ready' ? plugins.versions : null;
  const search = useRepositorySearch(text, !!user && !!installed);

  const groups = useMemo<IGroup[]>(() => {
    const matching = screens
      .filter((screen) => screen.label.toLowerCase().includes(needle))
      .slice(0, SCREEN_LIMIT)
      .map((screen) => ({
        id: `screen-${screen.id}`,
        name: screen.label,
        path: screen.path,
      }));

    const found: IGroup[] =
      matching.length > 0
        ? [{ id: 'screens', title: t`Go to`, results: matching }]
        : [];

    const repositories =
      search.state === 'ready' && installed
        ? repositoryResults(search.repositories, new Set(installed.keys()))
        : [];
    // A refusal stays unmentioned next to matching screens; on its own it
    // would read as "nothing matches", so it is named when nothing else is
    // listed.
    let status: IGroup['status'];
    if (search.state === 'loading' || search.state === 'failed') {
      status = search.state;
    } else if (search.state === 'refused' && found.length === 0) {
      status = 'refused';
    }
    if (repositories.length > 0 || status) {
      found.push({
        id: 'repositories',
        title: t`Repositories`,
        results: repositories,
        status,
      });
    }
    return found;
  }, [screens, needle, search, installed]);

  const results = groups.flatMap((group) => group.results);
  const highlighted =
    results.find((result) => result.id === highlightedId) ?? results[0];
  // Nothing to show, and nothing still on its way or left unsaid that could
  // explain why.
  const noMatch = results.length === 0 && !groups.some((group) => group.status);
  // While the repositories are still being looked up and nothing is listed
  // yet, "No results" would be untrue.
  const searching = results.length === 0 && search.state === 'loading';
  const optionId = (result: IResult) => `${listId}-${result.id}`;
  const highlightedElementId = highlighted ? optionId(highlighted) : undefined;

  // The list scrolls and the focus stays in the input, so the highlighted row
  // has to be brought into view by hand, or an arrow key could move the
  // highlight to a row nobody can see.
  useEffect(() => {
    if (highlightedElementId) {
      document
        .getElementById(highlightedElementId)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedElementId]);

  // The dialog has no close button: Escape closes it, and so does a press
  // anywhere outside it.
  useEffect(() => {
    const onPress = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('.pulp-palette')
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onPress);
    return () => document.removeEventListener('mousedown', onPress);
  }, [onClose]);

  const choose = (result: IResult) => {
    onClose();
    navigate(result.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // The keys of a text composition (an input method editor) belong to it:
    // Enter commits the composed text and must not open a result.
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length > 0) {
        const current = Math.max(results.indexOf(highlighted), 0);
        const next = step(
          current,
          event.key === 'ArrowDown' ? 1 : -1,
          results.length,
        );
        setHighlightedId(results[next].id);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (highlighted) {
        choose(highlighted);
      }
    }
  };

  return (
    <Modal
      isOpen
      variant='small'
      position='top'
      positionOffset='2rem'
      aria-label={t`Search or go to`}
      className='pulp-palette'
      elementToFocus={`#${INPUT_ID}`}
      onEscapePress={onClose}
    >
      <ModalBody className='pulp-palette__body'>
        <TextInputGroup className='pulp-palette__field'>
          <TextInputGroupMain
            inputId={INPUT_ID}
            icon={<SearchIcon />}
            value={query}
            placeholder={t`Search screens and repositories`}
            aria-label={t`Search screens and repositories`}
            role='combobox'
            isExpanded
            aria-controls={listId}
            aria-activedescendant={highlightedElementId}
            onChange={(_event, value) => {
              setQuery(value);
              setHighlightedId(null);
            }}
            inputProps={{
              onKeyDown,
              autoComplete: 'off',
              'aria-autocomplete': 'list',
            }}
          />
        </TextInputGroup>
        <div className='pf-v6-screen-reader' aria-live='polite'>
          {searching
            ? t`Searching repositories...`
            : plural(results.length, {
                0: 'No results',
                one: '# result',
                other: '# results',
              })}
        </div>
        <Menu role='listbox' isPlain className='pulp-palette__menu'>
          <MenuContent>
            <MenuList id={listId} aria-label={t`Results`}>
              {groups.map((group) => (
                <li key={group.id} role='none'>
                  <ul
                    role='group'
                    aria-labelledby={`${listId}-${group.id}`}
                    className={menuStyles.menuList}
                  >
                    <li
                      role='presentation'
                      id={`${listId}-${group.id}`}
                      className={menuStyles.menuGroupTitle}
                    >
                      {group.title}
                    </li>
                    {group.results.map((result) => (
                      <MenuItem
                        key={result.id}
                        id={optionId(result)}
                        isFocused={result === highlighted}
                        aria-label={
                          result.plugin
                            ? `${result.name}, ${result.plugin}`
                            : undefined
                        }
                        onClick={() => choose(result)}
                      >
                        <span className='pulp-palette__row'>
                          <span
                            className='pulp-palette__name'
                            title={result.name}
                          >
                            {result.name}
                          </span>
                          {result.plugin ? (
                            <span className='pulp-palette__plugin'>
                              {result.plugin}
                            </span>
                          ) : null}
                        </span>
                      </MenuItem>
                    ))}
                    {group.status === 'loading' ? (
                      <li role='presentation' className='pulp-palette__status'>
                        <Spinner size='sm' aria-hidden='true' />
                        {t`Searching repositories...`}
                      </li>
                    ) : null}
                    {group.status === 'refused' ? (
                      <li role='presentation' className='pulp-palette__status'>
                        {t`Repositories cannot be searched with your account.`}
                      </li>
                    ) : null}
                    {group.status === 'failed' && search.state === 'failed' ? (
                      <li role='presentation' className='pulp-palette__status'>
                        {t`Some repository lists could not be searched.`}
                        <Button variant='link' isInline onClick={search.retry}>
                          {t`Retry repository search`}
                        </Button>
                      </li>
                    ) : null}
                  </ul>
                </li>
              ))}
            </MenuList>
          </MenuContent>
        </Menu>
        {noMatch ? (
          <div className='pulp-palette__empty'>
            <Title headingLevel='h2' size='lg'>
              {t`No screens or repositories match`}
            </Title>
            <p>
              {t`Nothing matches "${text}". Check the spelling or try part of a repository name.`}
            </p>
          </div>
        ) : null}
        <p className='pulp-palette__hint'>
          {t`Up and Down to move, Enter to open, Esc to close`}
        </p>
      </ModalBody>
    </Modal>
  );
}

// The search and go-to control: the button for the sidebar's first slot, the
// keyboard shortcut that opens the palette from anywhere on the page, and the
// palette itself.
export const CommandPalette = () => {
  const [isOpen, setOpen] = useState(false);
  const opener = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  const close = useCallback(() => setOpen(false), []);

  // Ctrl+K and Cmd+K open the palette wherever the focus is, text fields
  // included, and the browser's own use of the shortcut is cancelled. The
  // capture phase runs before any field gets to handle the key.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        // The shortcut does nothing while the palette is open, which would
        // record the palette's own input as the place to return to, or while
        // another dialog is open, which the palette would stack over with a
        // second focus trap.
        if (isOpen || document.querySelector(DIALOG_SELECTOR)) {
          return;
        }
        opener.current = document.activeElement;
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () =>
      document.removeEventListener('keydown', onKey, { capture: true });
  }, [isOpen]);

  // When the palette closes, the focus goes back to the button; if the button
  // cannot take it (a collapsed sidebar), to what had it before.
  useEffect(() => {
    if (wasOpen.current && !isOpen) {
      const button = document.getElementById(TRIGGER_ID);
      button?.focus();
      if (
        document.activeElement !== button &&
        opener.current instanceof HTMLElement
      ) {
        opener.current.focus();
      }
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  const hint = isApplePlatform() ? t`Cmd K` : t`Ctrl K`;

  return (
    <>
      <button
        id={TRIGGER_ID}
        type='button'
        className='pulp-search'
        aria-keyshortcuts='Control+K Meta+K'
        aria-haspopup='dialog'
        onClick={() => {
          opener.current = document.activeElement;
          setOpen(true);
        }}
      >
        <SearchIcon className='pulp-search__icon' aria-hidden='true' />
        <span className='pulp-search__text'>{t`Search or go to...`}</span>
        <kbd className='pulp-search__hint' aria-hidden='true'>
          {hint}
        </kbd>
      </button>
      {isOpen ? <Palette onClose={close} /> : null}
    </>
  );
};
