/**
 * Typed API client wrapper that:
 * - Delegates to the existing legacy `api()` from `@/src/api` (auth headers + base URL)
 * - Returns Result<T> or AsyncResource<T> — no thrown exceptions across module boundaries
 * - Ensures every call has explicit loading / success / error handling
 *
 * Modules MUST import `apiCall` (or a module-scoped wrapper) instead of the raw legacy `api`.
 */
import { api as legacyApi } from "@/src/api";
import type { ApiRequest, Result } from "./types";
import { ok, err } from "./types";

export async function apiCall<T>(path: string, opts: ApiRequest = {}): Promise<Result<T>> {
  try {
    const legacyOpts: {
      method?: ApiRequest["method"];
      body?: unknown;
      query?: ApiRequest["query"];
      headers?: Record<string, string>;
    } = {};
    if (opts.method) legacyOpts.method = opts.method;
    if (opts.body !== undefined) legacyOpts.body = opts.body;
    if (opts.query) legacyOpts.query = opts.query;
    if (opts.headers) legacyOpts.headers = opts.headers;
    const data = await legacyApi<T>(path, legacyOpts as never);
    return ok<T>(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore di rete";
    return err<T>(msg);
  }
}
