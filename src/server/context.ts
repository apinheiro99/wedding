import { AsyncLocalStorage } from "node:async_hooks";

/** Who/where of the request being served. Every log line emitted while handling it carries these fields. */
export type RequestContext = { rid: string; ip?: string; ua?: string; uid?: string; user?: string; role?: string };

const als = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(c: RequestContext, fn: () => Promise<T>) => als.run(c, fn);
export const requestContext = () => als.getStore();

/** Called once the caller is authenticated so later log lines (and the access log) name the person. */
export function setContextUser(u: { id: string; displayName?: string; email?: string; role?: string }) {
  const c = als.getStore();
  if (!c) return;
  c.uid = u.id; c.user = u.displayName || u.email; c.role = u.role;
}
