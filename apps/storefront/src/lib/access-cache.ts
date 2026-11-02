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

/** What the Runtime said about a preview token. Only `valid` ever opens a locked store. */
export type PreviewCheck =
  | { readonly kind: "valid"; readonly expiresAtMs: number | null }
  | { readonly kind: "invalid" }
  | { readonly kind: "error" };

/**
 * Ruling 36: is this token a live preview of this shop? Only `200` with a body that says
 * `mode: "preview"` is `valid`: a proxy that drops the token header gets the LIVE shell with a 200,
 * which must not open a locked store, so that is `invalid`, like a 401. Any other status, a garbage
 * body, a throw or a timeout is `error`: it fails closed and is never cached.
 */
export function fetchPreviewValidity(
  runtimeApiUrl: string,
  timeoutMs: number = PREVIEW_TIMEOUT_MS,
): (shopId: string, token: string) => Promise<PreviewCheck> {
  return async (shopId, token) => {
    try {
      const response = await fetch(`${runtimeApiUrl}/api/v1/public/online-store`, {
        headers: { "x-tenant-id": shopId, "x-preview-token": token },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 401) return { kind: "invalid" };
      if (response.status !== 200) return { kind: "error" };
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null || Array.isArray(body))
        return { kind: "error" };
      const { mode, previewExpiresAt } = body as { mode?: unknown; previewExpiresAt?: unknown };
      if (mode !== "preview") return { kind: "invalid" };
      const expiresAtMs = typeof previewExpiresAt === "string" ? Date.parse(previewExpiresAt) : NaN;
      return { kind: "valid", expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null };
    } catch {
      return { kind: "error" };
    }
  };
}

/** The cache key for a token's answer: the shop and the token's SHA-256, never the token itself. */
export async function previewCacheKey(shopId: string, token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return `${shopId}:${hex}`;
}

/**
 * Review M-3: a short memory of the Runtime's answers, so a flood of one token (valid or not) costs
 * one Runtime call per 30 s instead of one per request. A valid answer is kept for `validTtlMs`, but
 * never past the token's own expiry (and not at all when that is unknown); an invalid one for
 * `invalidTtlMs`; an error or timeout never. Keyed by `previewCacheKey`, bounded (LRU).
 */
export function createPreviewChecker(deps: {
  readonly check: (shopId: string, token: string) => Promise<PreviewCheck>;
  readonly now: () => number;
  readonly validTtlMs: number;
  readonly invalidTtlMs: number;
  readonly maxEntries: number;
}): (shopId: string, token: string) => Promise<boolean> {
  const cache = new Map<string, { valid: boolean; until: number }>();
  const remember = (key: string, valid: boolean, until: number) => {
    cache.delete(key);
    cache.set(key, { valid, until });
    if (cache.size > deps.maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };
  return async (shopId, token) => {
    const key = await previewCacheKey(shopId, token);
    const hit = cache.get(key);
    if (hit !== undefined) {
      cache.delete(key);
      if (deps.now() < hit.until) {
        cache.set(key, hit); // most recently used
        return hit.valid;
      }
    }
    const answer = await deps.check(shopId, token);
    const now = deps.now();
    if (answer.kind === "invalid") remember(key, false, now + deps.invalidTtlMs);
    if (answer.kind === "valid" && answer.expiresAtMs !== null && answer.expiresAtMs > now)
      remember(key, true, Math.min(now + deps.validTtlMs, answer.expiresAtMs));
    return answer.kind === "valid";
  };
}
