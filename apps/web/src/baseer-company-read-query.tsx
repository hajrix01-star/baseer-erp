import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";

import type { ActiveSession } from "./daily-sales-client";

type QueryState<T> = { data: T | undefined; loading: boolean; error: unknown; refetch: () => Promise<void>; reload: () => Promise<T | undefined> };
type BaseerCompanyReadQueryProps<T> = {
  session: ActiveSession;
  /** Stable server resource identifier, never a human-readable route label. */
  resource: string;
  /** Filter/cursor intent. It is part of the key so pages or companies cannot share a cached result. */
  scope?: readonly string[];
  /**
   * Snapshot reads create or address an immutable server receipt. They must
   * never be repeated merely because the browser regained focus or network.
   */
  mode?: "live" | "snapshot";
  load: (session: ActiveSession, signal: AbortSignal) => Promise<T>;
  children: (state: QueryState<T>) => ReactNode;
};

const queryDefaults = { queries: { retry: false, staleTime: 30_000, gcTime: 0 } } as const;

/**
 * The app-shell cache boundary. Its identity changes on company, session or
 * token rotation, discarding every prior query and cancelling its observers.
 */
export function BaseerSessionQueryProvider({ session, children }: { session: ActiveSession; children: ReactNode }) {
  const sessionKey = `${session.companyId}:${session.sessionExpiresAt}:${session.accessToken}`;
  const client = useMemo(() => new QueryClient({ defaultOptions: queryDefaults }), [sessionKey]);
  return <QueryClientProvider key={sessionKey} client={client}>{children}</QueryClientProvider>;
}

export function baseerReadQueryKey(session: ActiveSession, resource: string, scope: readonly string[] = []) {
  return ["baseer", "read", session.companyId, session.sessionExpiresAt, resource, ...scope] as const;
}

function CompanyQuery<T>({ session, resource, scope, mode, load, children }: BaseerCompanyReadQueryProps<T>) {
  const snapshot = mode === "snapshot";
  const query = useQuery({
    queryKey: baseerReadQueryKey(session, resource, scope),
    queryFn: ({ signal }) => load(session, signal),
    ...(snapshot ? { staleTime: Infinity, retry: false, retryOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false } : {}),
  });
  const reload = async () => (await query.refetch({ throwOnError: true })).data;
  return <>{children({ data: query.data, loading: query.isPending, error: query.error, reload, refetch: async () => { await reload(); } })}</>;
}

/** A lazy company/session-scoped read cache for a single read surface. */
export function BaseerCompanyReadQuery<T>(props: BaseerCompanyReadQueryProps<T>) {
  const sessionKey = `${props.session.companyId}:${props.session.sessionExpiresAt}:${props.session.accessToken}:${props.scope?.join(":") ?? ""}`;
  const client = useMemo(() => new QueryClient({ defaultOptions: queryDefaults }), [sessionKey]);
  return <QueryClientProvider key={sessionKey} client={client}><CompanyQuery {...props} /></QueryClientProvider>;
}
