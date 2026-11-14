import { plural, t } from '@lingui/core/macro';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  TextInputGroup,
  TextInputGroupMain,
} from '@patternfly/react-core';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';
import menuStyles from '@patternfly/react-styles/css/components/Menu/menu.mjs';
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { useMenuModel } from 'src/menu';

// The most screens the palette lists.
const SCREEN_LIMIT = 8;

const TRIGGER_ID = 'pulp-palette-trigger';
const INPUT_ID = 'pulp-palette-input';

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
// and, optionally, a short qualifier in the right column.
interface IResult {
  id: string;
  name: string;
  path: string;
}

interface IGroup {
  id: string;
  title: string;
  results: IResult[];
}

// Moves the highlight one step through a list of the given length, wrapping at
// both ends.
function step(index: number, delta: 1 | -1, length: number): number {
  return (index + delta + length) % length;
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { screens } = useMenuModel();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();

  const groups = useMemo<IGroup[]>(() => {
    const matching = screens
      .filter((screen) => screen.label.toLowerCase().includes(needle))
      .slice(0, SCREEN_LIMIT)
      .map((screen) => ({
        id: `screen-${screen.id}`,
        name: screen.label,
        path: screen.path,
      }));

    return matching.length > 0
      ? [{ id: 'screens', title: t`Go to`, results: matching }]
      : [];
  }, [screens, needle]);

  const results = groups.flatMap((group) => group.results);
  const highlighted =
    results.find((result) => result.id === highlightedId) ?? results[0];
  const optionId = (result: IResult) => `${listId}-${result.id}`;

  const choose = (result: IResult) => {
    onClose();
    navigate(result.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
      onClose={onClose}
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
            aria-activedescendant={
              highlighted ? optionId(highlighted) : undefined
            }
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
          {plural(results.length, {
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
                        onClick={() => choose(result)}
                      >
                        <span
                          className='pulp-palette__name'
                          title={result.name}
                        >
                          {result.name}
                        </span>
                      </MenuItem>
                    ))}
                  </ul>
                </li>
              ))}
            </MenuList>
          </MenuContent>
        </Menu>
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
        opener.current = document.activeElement;
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () =>
      document.removeEventListener('keydown', onKey, { capture: true });
  }, []);

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
      {isOpen ? <Palette onClose={() => setOpen(false)} /> : null}
    </>
  );
};
