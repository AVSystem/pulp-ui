import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { createQueryClient } from 'src/query/client';

// A client for one test. It has the defaults of the application (a read stays
// fresh for a while, so a test sees when a screen really reads again), except
// that nothing is retried, so a failed read shows its error at once. A query
// nothing uses any more stays in the cache (no timer is left running after the
// test), which also lets a test look at what the cache holds.
export function createTestQueryClient(): QueryClient {
  const { queries } = createQueryClient().getDefaultOptions();

  return new QueryClient({
    defaultOptions: {
      queries: { ...queries, retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

// Gives the children the client of the test.
export function QueryWrapper({
  client,
  children,
}: {
  client: QueryClient;
  children: ReactNode;
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
