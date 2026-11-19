import { saveErrorMessages } from 'src/utilities/create-repository';
import {
  type ErrorMessagesType,
  mapErrorMessages,
} from 'src/utilities/map-error-messages';
import { requestErrorStatus } from 'src/utilities/request-error';

// What the user form shows for a failed save. A refusal says what was refused,
// Pulp's reason and whom to ask, as the repository and remote forms do; any
// other answer is shown by field as the server gave it. The end of a session
// maps to nothing: the sign-in dialog explains it.
export function userSaveErrors(error: unknown): ErrorMessagesType {
  return requestErrorStatus(error) === 403
    ? saveErrorMessages(error)
    : mapErrorMessages(error);
}
