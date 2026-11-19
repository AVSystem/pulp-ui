import { saveErrorMessages } from 'src/utilities/create-repository';
import {
  type ErrorMessagesType,
  mapErrorMessages,
} from 'src/utilities/map-error-messages';
import { requestErrorStatus } from 'src/utilities/request-error';

// The fields the role form shows a message beside.
const FIELDS = ['name', 'description'];

// A message of a field comes as text or as a list of sentences.
function textOf(message: unknown): string {
  return Array.isArray(message) ? message.join(' ') : String(message);
}

// What the role form shows for a failed save. A refusal says what was refused,
// Pulp's reason and whom to ask. A rejection is shown beside the field it names;
// whatever else the server said is shown under the form, with the field's name
// in front when there is one. The end of a session maps to nothing: the sign-in
// dialog explains it.
export function roleSaveErrors(error: unknown): ErrorMessagesType {
  if (requestErrorStatus(error) !== 400) {
    return saveErrorMessages(error);
  }

  const messages: ErrorMessagesType = {};
  const rest: string[] = [];

  for (const [field, message] of Object.entries(mapErrorMessages(error))) {
    if (FIELDS.includes(field)) {
      messages[field] = textOf(message);
    } else if (['__nofield', 'non_field_errors', 'detail'].includes(field)) {
      rest.push(textOf(message));
    } else {
      rest.push(`${field}: ${textOf(message)}`);
    }
  }
  if (rest.length) {
    messages['__nofield'] = rest.join(' ');
  }

  return messages;
}
