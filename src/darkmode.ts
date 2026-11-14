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
  const stored = window.localStorage.getItem('pulp-darkmode');
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
    window.localStorage.setItem('pulp-darkmode', value);
  } else {
    window.localStorage.removeItem('pulp-darkmode');
  }
  reflectEffectiveTheme();
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
