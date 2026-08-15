import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContextValue {
  readonly correlationId: string;
}

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const storage = new AsyncLocalStorage<RequestContextValue>();

/**
 * Request correlation only. It deliberately contains no identity, company,
 * request body, credentials, or mutable application state.
 */
export class RequestContext {
  static resolveCorrelationId(value: unknown): string {
    return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)
      ? value
      : randomUUID();
  }

  static run<T>(value: RequestContextValue, operation: () => T): T {
    return storage.run(value, operation);
  }

  static correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  }
}
