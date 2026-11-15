import {
  readStored,
  removeStored,
  writeStored,
} from 'src/utilities/safe-storage';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export const reflectPreference = (value: 'dark' | 'light') => {
  const html = document.firstElementChild.classList;

  if (value === 'dark') {
    html.add('pf-v6-theme-dark');
  } else {
    html.remove('pf-v6-theme-dark');
  }
};

// Only the two theme names count as a choice; anything else that may sit in
// the storage (an older build wrote the string "null" for no choice) leaves
// the decision to the system.
export const getUserChoice: () => 'dark' | 'light' | null = () => {
  const stored = readStored('pulp-darkmode');
  return stored === 'dark' || stored === 'light' ? stored : null;
};

export const getBrowserDefault: () => 'dark' | 'light' = () =>
  window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';

const reflectEffectiveTheme = () =>
  reflectPreference(getUserChoice() || getBrowserDefault());

// Remember an explicit theme, or forget the choice with null so the system
// preference applies again, and show the resulting theme.
export const setUserChoice = (value: 'dark' | 'light' | null) => {
  if (value === 'dark' || value === 'light') {
    writeStored('pulp-darkmode', value);
  } else {
    removeStored('pulp-darkmode');
  }
  // Shown from the argument, not read back, so the choice also takes effect
  // when the storage refuses to keep it.
  reflectPreference(
    value === 'dark' || value === 'light' ? value : getBrowserDefault(),
  );
};

// Show the system theme now and whenever it changes, for as long as the user
// has not chosen one. Returns the function that stops listening.
export const followSystemTheme = () => {
  const query = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    if (!getUserChoice()) {
      reflectEffectiveTheme();
    }
  };
  reflectEffectiveTheme();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

reflectEffectiveTheme();
