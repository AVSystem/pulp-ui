import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { lazyScreen } from './lazy-screen';

const Screen = ({ path }: { path: string }) => <p>Screen at {path}</p>;

describe('lazyScreen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the loading page until the screen is loaded, then the screen with its props', async () => {
    let release: (module: { default: typeof Screen }) => void;
    const Lazy = lazyScreen(
      () =>
        new Promise<{ default: typeof Screen }>((resolve) => {
          release = resolve;
        }),
    );

    renderWithProviders(<Lazy path='/zz-test' />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/Screen at/)).not.toBeInTheDocument();

    release({ default: Screen });

    expect(await screen.findByText('Screen at /zz-test')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows an error state with a Reload button when the screen cannot be loaded', async () => {
    const Lazy = lazyScreen<{ path: string }>(() =>
      Promise.reject(new Error('Loading chunk zz failed.')),
    );

    renderWithProviders(<Lazy path='/zz-test' />);

    expect(
      await screen.findByText('This screen could not be loaded'),
    ).toBeInTheDocument();
    expect(screen.getByText('Loading chunk zz failed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('reloads the page once when Reload is pressed', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const Lazy = lazyScreen<{ path: string }>(() =>
      Promise.reject(new Error('gone')),
    );

    const { user } = renderWithProviders(<Lazy path='/zz-test' />);

    await user.click(await screen.findByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
