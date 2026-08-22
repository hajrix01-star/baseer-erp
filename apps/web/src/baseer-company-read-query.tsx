import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import type { ActiveSession } from "./daily-sales-client";

type QueryState<T> = { data: T | undefined; loading: boolean; error: unknown; refetch: () => void };
type BaseerCompanyReadQueryProps<T> = {
  session: ActiveSession;
  resource: string;
  load: (session: ActiveSession, signal: AbortSignal) => Promise<T>;
  children: (state: QueryState<T>) => ReactNode;
};

function ScopedQuery<T>({ session, resource, load, children }: BaseerCompanyReadQueryProps<T>) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 0 } } }));
  return <QueryClientProvider client={client}><CompanyQuery session={session} resource={resource} load={load}>{children}</CompanyQuery></QueryClientProvider>;
}

function CompanyQuery<T>({ session, resource, load, children }: BaseerCompanyReadQueryProps<T>) {
  const query = useQuery({
    queryKey: ["baseer", resource, session.companyId, session.sessionExpiresAt],
    queryFn: ({ signal }) => load(session, signal),
  });
  return <>{children({ data: query.data, loading: query.isPending, error: query.error, refetch: () => { void query.refetch(); } })}</>;
}

/** A company/session-scoped read cache. A key change remounts and discards the prior cache. */
export function BaseerCompanyReadQuery<T>(props: BaseerCompanyReadQueryProps<T>) {
  return <ScopedQuery key={`${props.resource}:${props.session.companyId}:${props.session.sessionExpiresAt}`} {...props} />;
}
