import { UserAPI } from '../api/user';

// Reads of one user's record that overlap share a single request. The
// permission read and the profile page both need the signed-in user's own
// record and start together when the session becomes known; asking twice
// would only repeat the same answer. A read is shared only within one session
// epoch, so a read that began before the same user signed in again is never
// handed to a screen that asks after it.
const running = new Map<string, ReturnType<typeof UserAPI.get>>();

export function readOwnRecord(id: string, epoch = 0) {
  const key = `${epoch}:${id}`;
  const shared = running.get(key);
  if (shared) {
    return shared;
  }

  const read = UserAPI.get(id);
  running.set(key, read);
  const done = () => {
    if (running.get(key) === read) {
      running.delete(key);
    }
  };
  read.then(done, done);

  return read;
}
