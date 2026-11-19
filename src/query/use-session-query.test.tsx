import { act, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { reportUnauthorized } from 'src/session/session-events';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { useSessionQuery } from './use-session-query';

const NAME = ['pulp', 'test', 'thing'];

function Thing({ enabled }: { enabled?: boolean }) {
  const query = useSessionQuery({
    queryKey: NAME,
    enabled,
    queryFn: async () => {
      const response = await fetch('/pulp/api/v3/thing/');
      return (await response.json()) as { value: string };
    },
  });

  return <p data-testid='state'>{query.data?.value ?? query.fetchStatus}</p>;
}

// Mounts the query only when the button is pressed, so a test can end the
// session first.
function LateThing() {
  const [shown, setShown] = useState(false);

  return (
    <>
      <button type='button' onClick={() => setShown(true)}>
        Show
      </button>
      {shown ? <Thing /> : null}
    </>
  );
}

function serveThing() {
  const seen: string[] = [];
  server.use(
    http.get('*/pulp/api/v3/thing/', ({ request }) => {
      seen.push(request.url);
      return HttpResponse.json({ value: 'ok' });
    }),
  );
  return seen;
}

describe('Integration: useSessionQuery', { tags: ['integration'] }, () => {
  it('reads like any query while the session is in order', async () => {
    serveThing();

    renderWithProviders(<Thing />, { signedIn: true });

    expect(await screen.findByText('ok')).toBeInTheDocument();
  });

  it('sends no request while the session has ended', async () => {
    const seen = serveThing();
    const { user } = renderWithProviders(<LateThing />, { signedIn: true });

    act(() => reportUnauthorized('request'));
    await user.click(screen.getByRole('button', { name: 'Show' }));

    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toHaveLength(0);
  });

  it('keeps a query the caller disabled disabled', async () => {
    const seen = serveThing();

    renderWithProviders(<Thing enabled={false} />, { signedIn: true });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    expect(seen).toHaveLength(0);
  });
});
