import { AsyncLocalStorage } from "node:async_hooks";

// Where the request came from, for the audit log.
type RequestOrigin = { ip?: string | undefined; userAgent?: string | undefined };

// Who a request is for. Set once per request from the Host header (never from client input).
export type RequestContext = (
  { kind: "tenant"; tenantId: string; tenantSlug: string } | { kind: "admin" }
) &
  RequestOrigin;

const storage = new AsyncLocalStorage<RequestContext>();

// Prisma queries are lazy: they run when awaited. Await them inside `fn`; a query
// returned unawaited and awaited after `fn` runs outside the context and is refused.
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
