import { useEffect, useState } from 'react';

// Below this width the shell is a phone layout: the top bar keeps only its
// essentials and touch targets grow. It matches the stylesheet breakpoint.
const PHONE_QUERY = '(max-width: 767px)';

// Whether the page is narrower than a tablet, kept up to date when the window
// is resized or turned.
export function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(
    () => window.matchMedia(PHONE_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return phone;
}
