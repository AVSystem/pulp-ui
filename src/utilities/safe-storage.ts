// Browser storage that may be unavailable: a browser that blocks site data
// throws when the storage is touched at all, and a full one throws on writing.
// A value that cannot be stored or read is treated as not set, so a blocked
// storage degrades a preference to its default instead of stopping the page
// from starting.

type Area = 'localStorage' | 'sessionStorage';

export function readStored(key: string, area: Area = 'localStorage') {
  try {
    return window[area].getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(
  key: string,
  value: string,
  area: Area = 'localStorage',
) {
  try {
    window[area].setItem(key, value);
  } catch {
    // The value then lasts for this page only, or not at all.
  }
}

export function removeStored(key: string, area: Area = 'localStorage') {
  try {
    window[area].removeItem(key);
  } catch {
    // Nothing is stored, so there is nothing to remove.
  }
}
