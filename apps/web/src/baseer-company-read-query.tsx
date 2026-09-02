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
  /** Optional near-real-time refresh for live financial reads. */
  refreshIntervalMs?: number;
  load: (session: ActiveSession, signal: AbortSignal) => Promise<T>;
  children: (state: QueryState<T>) => ReactNode;
};

// Reads are shared by the authenticated shell.  Navigation, a focus change,
// or a short network interruption must not fan the same screen out into many
// requests; an explicit Refresh remains available to each workspace.
const queryDefaults = {
  queries: {
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
} as const;

const sessionClients = new Map<string, QueryClient>();

function sessionQueryClient(session: ActiveSession) {
  const sessionKey = `${session.companyId}:${session.sessionExpiresAt}:${session.accessToken}`;
  const existing = sessionClients.get(sessionKey);
  if (existing) return { client: existing, sessionKey };

  // The authenticated app holds one active company/session at a time. Drop
  // the prior client on company change or token rotation instead of retaining
  // stale data in a module cache.
  sessionClients.clear();
  const client = new QueryClient({ defaultOptions: queryDefaults });
  sessionClients.set(sessionKey, client);
  return { client, sessionKey };
}

/**
 * Optional shell bridge for a future authenticated shell. Its client is the
 * same session-scoped cache used by each route observer.
 */
export function BaseerSessionQueryProvider({ session, children }: { session: ActiveSession; children: ReactNode }) {
  const { client, sessionKey } = useMemo(() => sessionQueryClient(session), [session.companyId, session.sessionExpiresAt, session.accessToken]);
  return <QueryClientProvider key={sessionKey} client={client}>{children}</QueryClientProvider>;
}

export function baseerReadQueryKey(session: ActiveSession, resource: string, scope: readonly string[] = []) {
  return ["baseer", "read", session.companyId, session.sessionExpiresAt, resource, ...scope] as const;
}

function CompanyQuery<T>({ session, resource, scope, mode, refreshIntervalMs, load, children }: BaseerCompanyReadQueryProps<T>) {
  const snapshot = mode === "snapshot";
  const query = useQuery({
    queryKey: baseerReadQueryKey(session, resource, scope),
    queryFn: ({ signal }) => load(session, signal),
    refetchInterval: snapshot ? false : refreshIntervalMs,
    ...(snapshot ? { staleTime: Infinity, retry: false, retryOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false } : {}),
  });
  const reload = async () => (await query.refetch({ throwOnError: true })).data;
  return <>{children({ data: query.data, loading: query.isPending, error: query.error, reload, refetch: async () => { await reload(); } })}</>;
}

/** A company/session-scoped read observer backed by the authenticated shell cache. */
export function BaseerCompanyReadQuery<T>(props: BaseerCompanyReadQueryProps<T>) {
  const { client, sessionKey } = useMemo(() => sessionQueryClient(props.session), [props.session.companyId, props.session.sessionExpiresAt, props.session.accessToken]);
  return <QueryClientProvider key={sessionKey} client={client}><CompanyQuery {...props} /></QueryClientProvider>;
}
