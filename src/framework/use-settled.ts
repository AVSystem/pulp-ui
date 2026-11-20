import { useEffect, useState } from 'react';

// The value after it has stopped changing for a moment, so a search is sent
// for the text typed and not for every key.
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
