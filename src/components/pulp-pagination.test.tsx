import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { PulpPagination } from './pulp-pagination';

async function choicesOf(props: { perPageOptions?: readonly number[] }) {
  const { user } = renderWithProviders(
    <PulpPagination
      count={1000}
      params={{ page: 1, page_size: 10 }}
      updateParams={vi.fn()}
      isTop
      {...props}
    />,
  );
  await user.click(screen.getByRole('button', { name: /^1 - \d+ of/ }));

  return (await screen.findAllByRole('menuitem')).map((item) =>
    item.textContent?.replace(/\D+/g, ''),
  );
}

describe('Integration: the pagination', { tags: ['integration'] }, () => {
  it('offers the page sizes 10, 20, 50 and 100 unless told otherwise', async () => {
    expect(await choicesOf({})).toEqual(['10', '20', '50', '100']);
  });

  it('offers the page sizes it is given', async () => {
    expect(await choicesOf({ perPageOptions: [25, 500] })).toEqual([
      '25',
      '500',
    ]);
  });
});
