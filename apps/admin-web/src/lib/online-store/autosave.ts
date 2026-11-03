export type AutosaveState = "idle" | "saving" | "saved" | "error" | "conflict";
/** `error` is transient (network, timeout, in flight) and retried; `invalid` (a 422) is final. */
export type SaveOutcome = "ok" | "conflict" | "error" | "invalid";

/** Backoff for transient failures: three retries, then the merchant's Retry (or a flush). */
const RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 15_000];

/**
 * Decision 36: save `delayMs` after the LAST change, one request in flight at a time, the latest
 * value wins; a conflict stops autosave (the editor asks for a reload) instead of overwriting.
 *
 * - A failed save is kept. A transient `error` is retried on its own with a capped backoff
 *   (`retryDelaysMs`); a refused save (`invalid`, a 422 such as a missing logo, Ruling 3) is never
 *   retried on a timer, so it cannot loop. Either is retried by the next `flush()` (Publish,
 *   Preview, Retry, page hide) or replaced by the next change.
 * - `flush()` saves now and returns the outcome that decides whether the server holds what the
 *   panels show: `"conflict"` once stopped, else the last save's outcome (`null` if none ran).
 * - `hasUnsaved()` is true while a change waits, is being saved, or failed (unload guard, I-2).
 * - `dispose()` only clears the timer (preflight F19): React Strict Mode's simulated unmount must
 *   not switch autosave off for the remounted editor.
 */
export function createAutosaver<T>(options: {
  readonly delayMs: number;
  readonly save: (value: T) => Promise<SaveOutcome>;
  readonly onState: (state: AutosaveState) => void;
  readonly retryDelaysMs?: readonly number[];
}) {
  const retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  let pending: { readonly value: T } | null = null;
  let failed: { readonly value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;
  let last: SaveOutcome | null = null;
  let retries = 0;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** The failed value becomes the pending one again (a retry); a newer change always wins. */
  const requeueFailed = () => {
    if (!stopped && pending === null && failed !== null) {
      pending = failed;
      failed = null;
    }
  };

  const saveOne = async (value: T): Promise<void> => {
    options.onState("saving");
    const outcome = await options.save(value).catch((): SaveOutcome => "error");
    last = outcome;
    if (outcome === "conflict") {
      stopped = true;
      pending = null;
      failed = null;
      clearTimer();
      options.onState("conflict");
      return;
    }
    if (outcome === "ok") {
      retries = 0;
      if (pending === null) options.onState("saved");
      return;
    }
    if (pending !== null) return; // a newer change replaces the failed value
    failed = { value };
    options.onState("error");
    if (outcome === "error" && retries < retryDelays.length && timer === null) {
      const delay = retryDelays[retries] ?? 0;
      retries += 1;
      timer = setTimeout(() => {
        timer = null;
        requeueFailed();
        void drain();
      }, delay);
    }
  };

  /** Saves pending values one at a time; a change still waiting for its timer waits for it. */
  const drain = (): Promise<void> => {
    if (running !== null) return running;
    // Checked first so the loop below always awaits before it clears `running`.
    if (stopped || pending === null || timer !== null) return Promise.resolve();
    running = (async () => {
      while (!stopped && pending !== null && timer === null) {
        const { value } = pending;
        pending = null;
        await saveOne(value);
      }
      running = null;
    })();
    return running;
  };

  return {
    schedule(value: T): void {
      if (stopped) return;
      pending = { value };
      failed = null;
      retries = 0;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, options.delayMs);
    },
    async flush(): Promise<SaveOutcome | null> {
      clearTimer();
      if (running !== null) await running;
      clearTimer(); // a change made (or a retry set) while waiting is saved now too
      requeueFailed();
      await drain();
      return stopped ? "conflict" : last;
    },
    hasUnsaved(): boolean {
      return !stopped && (pending !== null || failed !== null || running !== null);
    },
    dispose(): void {
      clearTimer();
    },
  };
}

/** What the server said to one draft save, reduced to what the replay logic needs. */
export type SendAnswer =
  | { readonly status: "ok"; readonly version: number }
  | { readonly status: "conflict" | "invalid" | "transient" };

/**
 * I-1 / Ruling 2: optimistic saves that survive a lost response. A save whose answer never arrived
 * (`transient`: network, timeout, duplicate key in flight) may have committed, so it stays
 * unresolved with its `expectedVersion` and Idempotency-Key. Before anything else is sent, that same
 * request is replayed with the same key: a replayed 200 moves the version on, and only then does
 * the next value go out, on that version. A false `VERSION_CONFLICT` cannot follow a lost answer.
 */
export function createReplayingSender<T>(options: {
  readonly initialVersion: number;
  readonly send: (value: T, expectedVersion: number, idempotencyKey: string) => Promise<SendAnswer>;
  readonly newKey?: () => string;
}) {
  const newKey = options.newKey ?? newClientKey;
  let version = options.initialVersion;
  let unresolved: {
    readonly value: T;
    readonly expectedVersion: number;
    readonly key: string;
  } | null = null;

  const attempt = async (value: T, expectedVersion: number, key: string): Promise<SaveOutcome> => {
    const answer = await options
      .send(value, expectedVersion, key)
      .catch((): SendAnswer => ({ status: "transient" }));
    if (answer.status === "transient") {
      unresolved = { value, expectedVersion, key };
      return "error";
    }
    unresolved = null;
    if (answer.status === "ok") {
      version = answer.version;
      return "ok";
    }
    return answer.status;
  };

  return {
    async save(value: T): Promise<SaveOutcome> {
      const previous = unresolved;
      if (previous !== null) {
        const replayed = await attempt(previous.value, previous.expectedVersion, previous.key);
        if (replayed === "conflict") return "conflict";
        if (unresolved !== null) return "error"; // still no answer: hold the new value back
        if (previous.value === value) return replayed; // the retry was this very value
      }
      return attempt(value, version, newKey());
    },
  };
}

/** 16 random bytes as hex: an Idempotency-Key the browser can make (no `node:crypto` here). */
export function newClientKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Ruling 2: one Idempotency-Key per distinct request. The same request (same `fingerprint`, e.g.
 * the publish revision) keeps its key, so a retry after a lost response replays the first answer;
 * any change, or `reset()` after a final answer, makes a new key.
 */
export function createRequestKey(newKey: () => string = newClientKey) {
  let current: { readonly fingerprint: string; readonly key: string } | null = null;
  return {
    keyFor(fingerprint: string): string {
      if (current === null || current.fingerprint !== fingerprint)
        current = { fingerprint, key: newKey() };
      return current.key;
    },
    reset(): void {
      current = null;
    },
  };
}
