import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { MultipleRepoSelector } from './multiple-repo-selector';

const API = '/pulp/api/v3';

function renderSelector(addAlert = vi.fn()) {
  renderWithProviders(
    <MultipleRepoSelector
      addAlert={addAlert}
      selectedRepos={[]}
      setSelectedRepos={vi.fn()}
    />,
  );
  return addAlert;
}

describe('repository selector', () => {
  it('raises an alert with the reason when the list request gets no answer', async () => {
    server.use(
      http.get(`*${API}/repositories/ansible/ansible/`, () =>
        HttpResponse.error(),
      ),
    );

    const addAlert = renderSelector();

    await waitFor(() =>
      expect(addAlert).toHaveBeenCalledWith({
        title: 'Failed to load repositories.',
        variant: 'danger',
        description: 'Network Error',
      }),
    );
  });

  it('keeps the status line in the alert when the server answers an error', async () => {
    server.use(
      http.get(`*${API}/repositories/ansible/ansible/`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Broken' }),
      ),
    );

    const addAlert = renderSelector();

    await waitFor(() => expect(addAlert).toHaveBeenCalledTimes(1));
    expect(addAlert.mock.calls[0][0]).toMatchObject({
      title: 'Failed to load repositories.',
      variant: 'danger',
    });
    expect(String(addAlert.mock.calls[0][0].description)).toMatch(/Error 500/);
  });
});
