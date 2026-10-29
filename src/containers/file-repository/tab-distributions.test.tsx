import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { distribution, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { type RepositoryDistribution } from 'src/utilities/repository-distributions';
import { DistributionsTab } from './tab-distributions';

// A distribution as the repository page passes it to the tab: the page has
// already loaded and merged them.
function loaded(
  overrides: Partial<RepositoryDistribution> = {},
): RepositoryDistribution {
  const base = distribution();
  return {
    pulp_href: base.pulp_href,
    name: base.name,
    base_path: base.base_path,
    url: base.base_url,
    served: true,
    binding: 'repository',
    content_guard: null,
    pulp_created: base.pulp_created,
    ...overrides,
  };
}

function renderTab(
  distributions: RepositoryDistribution[],
  distributionsError: string | null = null,
) {
  const addAlert = vi.fn();
  const item = {
    ...repository({ name: 'tools' }),
    distributions,
    distributionsError,
  };
  renderWithProviders(
    <DistributionsTab
      item={item as never}
      actionContext={{
        addAlert,
        state: { params: {} },
        hasPermission: () => true,
      }}
    />,
  );
  return { addAlert };
}

describe('file repository Distributions tab', () => {
  it('shows the base_url the server reports and a CLI line that ends with that URL plus PULP_MANIFEST', async () => {
    const url = 'https://pulp.example/pulp/content/served/tools/';
    renderTab([loaded({ name: 'tools-dist', base_path: 'tools', url })]);

    const row = (await screen.findByText('tools-dist')).closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);

    // the URL cell and the CLI line both carry the server's URL
    const occurrences = cells.getAllByText((content) => content.includes(url), {
      selector: 'span, input, code, p',
    });
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    const cliLine = cells.getByText(/PULP_MANIFEST/);
    expect(cliLine.textContent).toContain(`${url}PULP_MANIFEST`);
  });

  it('shows no manifest line for a distribution the server gave no URL', async () => {
    renderTab([loaded({ name: 'no-url', url: null })]);

    const row = (await screen.findByText('no-url')).closest('tr');

    expect(within(row as HTMLElement).queryByText(/PULP_MANIFEST/)).toBeNull();
  });

  it('lists every distribution it was given with its own URL', async () => {
    renderTab([
      loaded({ name: 'first', url: 'https://pulp.example/pulp/content/a/' }),
      loaded({
        name: 'second',
        url: 'https://pulp.example/pulp/content/b/',
        binding: 'publication',
      }),
    ]);

    const first = (await screen.findByText('first')).closest('tr');
    const second = screen.getByText('second').closest('tr');

    expect(first?.textContent).toContain(
      'https://pulp.example/pulp/content/a/PULP_MANIFEST',
    );
    expect(second?.textContent).toContain(
      'https://pulp.example/pulp/content/b/PULP_MANIFEST',
    );
  });

  it('shows the not served label next to a distribution without a publication', async () => {
    renderTab([loaded({ name: 'bare', served: false })]);

    const row = (await screen.findByText('bare')).closest('tr');

    expect(
      within(row as HTMLElement).getByText(/Not served: no publication/),
    ).toBeInTheDocument();
  });

  it('reports a failed distribution load in an alert instead of listing nothing silently', async () => {
    const { addAlert } = renderTab([], 'Error 500 - the server failed');

    await screen.findByText(/No distribution serves this repository/);

    expect(addAlert).toHaveBeenCalledTimes(1);
    expect(addAlert.mock.calls[0][0]).toMatchObject({
      variant: 'danger',
      description: 'Error 500 - the server failed',
    });
  });
});
