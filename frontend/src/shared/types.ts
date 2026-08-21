/**
 * Shared types used by module public APIs.
 * Every module MUST use AsyncResource<T> to expose async data states,
 * ensuring loading / success / error are always handled explicitly.
 */

export type AsyncIdle = { status: "idle" };
export type AsyncLoading = { status: "loading" };
export type AsyncSuccess<T> = { status: "success"; data: T };
export type AsyncError = { status: "error"; error: string };

export type AsyncResource<T> =
  | AsyncIdle
  | AsyncLoading
  | AsyncSuccess<T>
  | AsyncError;

export const asyncIdle = <T,>(): AsyncResource<T> => ({ status: "idle" });
export const asyncLoading = <T,>(): AsyncResource<T> => ({ status: "loading" });
export const asyncSuccess = <T,>(data: T): AsyncResource<T> => ({ status: "success", data });
export const asyncError = <T,>(error: string): AsyncResource<T> => ({ status: "error", error });

export const isLoading = <T,>(r: AsyncResource<T>): r is AsyncLoading => r.status === "loading";
export const isSuccess = <T,>(r: AsyncResource<T>): r is AsyncSuccess<T> => r.status === "success";
export const isError = <T,>(r: AsyncResource<T>): r is AsyncError => r.status === "error";

/**
 * Result type for one-shot operations that don't need a full lifecycle.
 * Prefer `Result<T>` over throwing exceptions across module boundaries.
 */
export type ResultOk<T> = { ok: true; data: T };
export type ResultErr = { ok: false; error: string };
export type Result<T> = ResultOk<T> | ResultErr;

export const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
export const err = <T,>(error: string): Result<T> => ({ ok: false, error });

/** Minimal request configuration accepted by module API clients. */
export type ApiRequest = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
};
