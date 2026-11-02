export interface AccessState {
  readonly locked: boolean;
  readonly accessVersion: number;
}

/** Ruling 2: a hung Runtime must not hang every page; past this the read throws (→ stale or 503). */
const ACCESS_TIMEOUT_MS = 2_000;
/** Same budget as the layout's own shell read (`lib/online-store.ts`). */
const PREVIEW_TIMEOUT_MS = 3_000;

/**
 * The middleware's own view of the lock (spec 1.12): fresh for `ttlMs` (15 s); when the Runtime fails,
 * the last known value is served for up to `staleMs` (5 min); a failure is never cached, and with no
 * known value the caller gets the error (→ 503, fail closed). One entry per shop id.
 */
export function createAccessReader(deps: {
  readonly fetchAccess: (shopId: string) => Promise<AccessState>;
  readonly now: () => number;
  readonly ttlMs: number;
  readonly staleMs: number;
  readonly maxEntries?: number;
}): (shopId: string) => Promise<AccessState> {
  const cache = new Map<string, { value: AccessState; fetchedAt: number }>();
  const maxEntries = deps.maxEntries ?? 5000;
  return async (shopId) => {
    const hit = cache.get(shopId);
    if (hit !== undefined && deps.now() - hit.fetchedAt < deps.ttlMs) return hit.value;
    try {
      const value = await deps.fetchAccess(shopId);
      cache.delete(shopId); // re-insert, so the Map's order is the order of storing
      cache.set(shopId, { value, fetchedAt: deps.now() });
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return value;
    } catch (error) {
      if (hit !== undefined && deps.now() - hit.fetchedAt <= deps.staleMs) return hit.value;
      throw error;
    }
  };
}

/** `GET /public/online-store/access`; throws on anything but a well-shaped 2xx (never guesses). */
export function fetchAccessFromRuntime(
  runtimeApiUrl: string,
  timeoutMs: number = ACCESS_TIMEOUT_MS,
): (shopId: string) => Promise<AccessState> {
  return async (shopId) => {
    const response = await fetch(`${runtimeApiUrl}/api/v1/public/online-store/access`, {
      headers: { "x-tenant-id": shopId },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`access read failed with ${response.status}`);
    const body = (await response.json()) as { locked?: unknown; accessVersion?: unknown } | null;
    const version = body?.accessVersion;
    if (
      typeof body?.locked !== "boolean" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 0
    )
      throw new Error("access read: bad shape");
    return { locked: body.locked, accessVersion: version };
  };
}

/**
 * Ruling 36: is this token a live preview of this shop? Asked of the Runtime on every request (never
 * cached). Only `200` with a body that says `mode: "preview"` counts: a proxy that drops the token
 * header gets the LIVE shell with a 200, which must not open a locked store. Any other answer, a
 * throw or a timeout is `false` (fail closed).
 */
export function fetchPreviewValidity(
  runtimeApiUrl: string,
  timeoutMs: number = PREVIEW_TIMEOUT_MS,
): (shopId: string, token: string) => Promise<boolean> {
  return async (shopId, token) => {
    try {
      const response = await fetch(`${runtimeApiUrl}/api/v1/public/online-store`, {
        headers: { "x-tenant-id": shopId, "x-preview-token": token },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) return false;
      const body = (await response.json()) as { mode?: unknown } | null;
      return body?.mode === "preview";
    } catch {
      return false;
    }
  };
}
