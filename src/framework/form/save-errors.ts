import type { ReactNode } from 'react';
import { mapErrorMessages } from 'src/utilities/map-error-messages';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorStatus,
} from 'src/utilities/request-error';

// What a failed save shows: a message under each field the server named, and
// one general message for everything else.
export interface SaveFailure {
  fields: Record<string, string>;
  // A refusal (the three-part description), a message that belongs to no field
  // or to a field the form does not show, or the status line of a failure with
  // no message at all. Null when every message found its field.
  general: ReactNode | null;
}

// The keys under which a server puts a message that belongs to no field.
const GENERAL_KEYS = ['non_field_errors', 'detail', '__nofield'];

// Every text in a message, however deeply the server nested it.
function textsOf(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }
  if (depth > 3 || typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.values(value).flatMap((item) => textsOf(item, depth + 1));
}

// Maps whatever a save threw onto the form. A refusal (403) is the same
// three-part description every refused action shows, never a bare line; a
// rejection of values shows each message under its field, and what has no
// field to sit under (or names a field this form does not have) goes in the
// general message, with the name of the field it concerns. The end of a session
// maps to nothing, because the sign-in dialog explains it and the form keeps
// what was typed.
export function saveFailure(
  error: unknown,
  shownFields: readonly string[],
): SaveFailure | null {
  if (isSessionEnd(error)) {
    return null;
  }

  if (requestErrorStatus(error) === 403) {
    return { fields: {}, general: requestErrorDescription(error) };
  }

  const fields: Record<string, string> = {};
  const general: string[] = [];

  if (requestErrorStatus(error) !== null) {
    for (const [name, message] of Object.entries(mapErrorMessages(error))) {
      const texts = textsOf(message);
      if (texts.length === 0) {
        continue;
      }
      if (shownFields.includes(name)) {
        fields[name] = texts.join(' ');
      } else if (GENERAL_KEYS.includes(name)) {
        general.push(texts.join(' '));
      } else {
        general.push(`${name}: ${texts.join(' ')}`);
      }
    }
  }

  if (Object.keys(fields).length === 0 && general.length === 0) {
    return { fields, general: requestErrorDescription(error) };
  }

  return {
    fields,
    general: general.length > 0 ? general.join(' ') : null,
  };
}
