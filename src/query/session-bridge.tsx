import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useUserContext } from 'src/user-context';

// Keeps the query cache in step with the session. It renders nothing and sits
// inside the user context, next to the screens that read through the cache.
export function SessionQueryBridge() {
  const queryClient = useQueryClient();
  const { generation, epoch } = useUserContext();
  // The values the cache was last brought in step with, so mounting the bridge
  // (or running its effects twice in development) does nothing.
  const seen = useRef({ generation, epoch });

  // The account in memory went away (a sign-out, the end of the session by
  // the user's own hand) or was replaced by another account. What was read for
  // that account must not be shown to the next one, so the running reads are
  // cancelled and the cache is emptied. Cancelling first keeps the answer of a
  // read that is still on its way from landing in the emptied cache.
  useEffect(() => {
    if (seen.current.generation === generation) {
      return;
    }
    seen.current.generation = generation;
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient, generation]);

  // The same user signed in again after the session ended. The screens on
  // the page stay, so the reads they show are made again. A read that is still
  // running for the older session is cancelled first, so its answer is
  // discarded and only the new one is shown: this holds also for a screen whose
  // query was switched off while the session was over, which the refetch alone
  // would leave running. A query nothing shows is only marked out of date and
  // reads again when a screen next needs it.
  useEffect(() => {
    if (seen.current.epoch === epoch) {
      return;
    }
    seen.current.epoch = epoch;
    void queryClient.cancelQueries();
    void queryClient.invalidateQueries();
  }, [queryClient, epoch]);

  return null;
}
