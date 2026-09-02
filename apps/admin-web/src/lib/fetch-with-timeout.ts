/**
 * Phase A.34 (A.33 P1 #6) — every external fetch in this app (Hydra/Kratos/Admin API) had no
 * timeout at all: a hung backend hung the request's Suspense boundary indefinitely. Not a new HTTP
 * abstraction — a single `AbortController` wrapper around the platform `fetch`, same signature,
 * used in place of a bare `fetch(...)` call wherever this app talks to an external service.
 */
const DEFAULT_TIMEOUT_MS = 8_000;

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
