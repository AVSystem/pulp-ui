import {
  getRepositoryVersionsListUrl,
  repositoryVersionsList,
} from '@pulp-ui/sdk/core/repository-versions';
import { chunkByUrl } from 'src/entities/batch';
import { parseResponse } from 'src/entities/response-shape';
import { type VersionSummary, versionSummaryPageSchema } from './model';

// The fields a read of version summaries asks for.
const SUMMARY_FIELDS = ['pulp_href', 'content_summary'];

// The request that reads the summaries of the versions at some addresses with
// one page: as many rows as addresses.
function summaryRequest(hrefs: readonly string[]) {
  return {
    pulp_href__in: [...hrefs],
    limit: Math.max(hrefs.length, 1),
    fields: SUMMARY_FIELDS,
  };
}

// Splits version addresses into groups, each read by one request whose URL
// stays under the budget. Every address is kept once, in order.
function chunks(hrefs: readonly string[]): string[][] {
  return chunkByUrl(
    (group) => getRepositoryVersionsListUrl(summaryRequest(group)),
    Array.from(new Set(hrefs)),
  );
}

// The summaries of the versions at these addresses, read with one request. The
// group should come from `chunks`; an empty group sends nothing. A row of an
// address that was not asked for is dropped: a server that ignored the filter
// would answer versions nobody wanted. The options reach `fetch`, so an abort
// signal cancels the request.
async function summaries(
  hrefs: readonly string[],
  options?: RequestInit,
): Promise<VersionSummary[]> {
  if (hrefs.length === 0) {
    return [];
  }
  const data = await repositoryVersionsList(summaryRequest(hrefs), options);
  const asked = new Set(hrefs);

  return parseResponse(versionSummaryPageSchema, data).results.filter((row) =>
    asked.has(row.pulp_href),
  );
}

export const RepositoryVersionClient = { chunks, summaries };
