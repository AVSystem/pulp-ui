import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAppContext } from 'src/app-context';
import type { AlertType } from 'src/components';

const NONE: AlertType[] = [];

// The alerts a screen shows. What another screen queued for the next one (the
// result of a save or of a delete) is taken over, once, when this screen
// appears, and also when it arrives later: a delete that ends while the user
// is already on this screen reports here instead of waiting for another one.
// Taking an alert over removes it from the queue, so it shows on one screen
// only.
//
// `handOver` queues an alert for the screen the user is about to go to. This
// screen leaves it in the queue instead of taking it back, which it would do
// for an alert that arrives while it is still shown.
export function useQueuedAlerts(): {
  alerts: AlertType[];
  setAlerts: Dispatch<SetStateAction<AlertType[]>>;
  handOver: (alert: AlertType) => void;
} {
  const { alerts: all, setAlerts: setQueued, queueAlert } = useAppContext();
  const queued = all ?? NONE;
  const [alerts, setAlerts] = useState<AlertType[]>(queued);
  const taken = useRef<AlertType[]>(queued);
  const handingOver = useRef(false);

  useEffect(() => {
    if (queued.length === 0 || handingOver.current) {
      return;
    }
    const fresh = queued.filter((alert) => !taken.current.includes(alert));
    if (fresh.length > 0) {
      taken.current = [...taken.current, ...fresh];
      setAlerts((current) => [...current, ...fresh]);
    }
    setQueued([]);
  }, [queued, setQueued]);

  const handOver = useCallback(
    (alert: AlertType) => {
      handingOver.current = true;
      queueAlert(alert);
    },
    [queueAlert],
  );

  return { alerts, setAlerts, handOver };
}
