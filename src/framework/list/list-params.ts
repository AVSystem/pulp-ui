import { apiPathOfHref } from 'src/entities/href';

// What a list screen shows is what its address says. The address is user input,
// so it is read into values the screen offers and nothing else: a page size
// that is not one of the choices, a sort field the server is not asked to sort
// by and a filter the screen does not have never reach a request.

// The page sizes a list offers.
export const PAGE_SIZES: readonly number[] = [10, 20, 50, 100, 200, 500];

export const DEFAULT_PAGE_SIZE = 50;

export const DEFAULT_SORT = 'name';

// The page, its size, the order and the filters that are set. A filter is a
// single text value under the name of the query parameter it sets.
export type ListParams = {
  page: number;
  page_size: number;
  sort: string;
} & Record<string, string | number>;

export interface ListAddressOptions {
  // The fields the server can order the list by.
  sortable: readonly string[];
  // The query parameters of the filters the screen has.
  filters: readonly string[];
  // What the address leaves out: the page size and the order a screen shows
  // when the address names none. A repository or remote list shows 50 rows by
  // name; a tab of a repository may differ.
  defaultPageSize?: number;
  defaultSort?: string;
}

const DIGITS = /^[1-9][0-9]*$/;

// Whether the address may set a filter to this text. The remote filter takes
// the address of a remote, which later decides where a read goes, or `null`
// for repositories that have none: anything else is ignored. Every other text
// is only ever sent as the value of a filter, which the server checks.
function acceptsFilter(param: string, value: string): boolean {
  if (param !== 'remote') {
    return true;
  }
  return (
    value === 'null' ||
    (apiPathOfHref(value) !== null && /\/remotes\/[^/]+\//.test(value))
  );
}

// The list the address asks for, as the screen shows it.
export function paramsOfAddress(
  address: string,
  {
    sortable,
    filters,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    defaultSort = DEFAULT_SORT,
  }: ListAddressOptions,
): ListParams {
  const search = new URLSearchParams(address);

  // A parameter that came in more than once is read as its first value, which
  // is what `get` answers.
  const page = search.get('page');
  const size = search.get('page_size');
  const sort = search.get('sort');

  const pageSize = size !== null && DIGITS.test(size) ? Number(size) : NaN;
  const field = sort?.startsWith('-') ? sort.slice(1) : sort;

  const params: ListParams = {
    page:
      page !== null && DIGITS.test(page) && Number.isSafeInteger(Number(page))
        ? Number(page)
        : 1,
    page_size: PAGE_SIZES.includes(pageSize) ? pageSize : defaultPageSize,
    sort:
      sort !== null && field !== null && sortable.includes(field)
        ? sort
        : defaultSort,
  };

  for (const key of filters) {
    const value = search.get(key);
    if (value && acceptsFilter(key, value)) {
      params[key] = value;
    }
  }

  return params;
}

// The query string of a list, leaving out what is the default so the plain
// address of a list stays plain. An empty string when nothing differs.
export function searchOf(
  params: ListParams,
  {
    defaultPageSize = DEFAULT_PAGE_SIZE,
    defaultSort = DEFAULT_SORT,
  }: Pick<ListAddressOptions, 'defaultPageSize' | 'defaultSort'> = {},
): string {
  const parts: string[] = [];

  if (params.page !== 1) {
    parts.push(`page=${params.page}`);
  }
  if (params.page_size !== defaultPageSize) {
    parts.push(`page_size=${params.page_size}`);
  }
  if (params.sort !== defaultSort) {
    parts.push(`sort=${encodeURIComponent(params.sort)}`);
  }
  for (const [key, value] of Object.entries(params)) {
    if (!['page', 'page_size', 'sort'].includes(key) && value !== '') {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
