// A value as it is compared: an emptied text field, a missing field and an
// object without keys (no labels) all mean "no value", and objects are
// compared by content, not by the order their keys happen to be in.
function comparable(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'null';
  }

  if (typeof value === 'object') {
    if (!Array.isArray(value) && !Object.keys(value).length) {
      return 'null';
    }
    return JSON.stringify(value, (_key, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          )
        : v,
    );
  }

  // a number and the same number typed into a form field are one value
  return `${typeof value === 'number' ? 'string' : typeof value}:${String(value)}`;
}

// The fields of `edited` whose value differs from `original`, for the body of
// a PATCH. Sending only these keeps an edit from overwriting a field the user
// did not touch with the value the form read earlier. An emptied field is
// returned as null, because the server rejects a blank string for a nullable
// field.
export function changedFields(
  original: Record<string, unknown>,
  edited: Record<string, unknown>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(edited)) {
    if (comparable(original?.[key]) === comparable(value)) {
      continue;
    }
    changes[key] = value === '' ? null : value;
  }

  return changes;
}
