export type AutosaveState = "idle" | "saving" | "saved" | "error" | "conflict";
export type SaveOutcome = "ok" | "conflict" | "error";

/**
 * Decision 36: save `delayMs` after the LAST change, one request in flight at a time, the latest
 * value wins; a conflict stops autosave (the editor asks for a reload) instead of overwriting.
 *
 * - A failed save is kept and retried by the next `flush()` (Publish, Preview, Retry) or replaced by
 *   the next change; it is never retried on a timer, so a save the server keeps refusing (a missing
 *   logo, Ruling 3) cannot loop.
 * - `flush()` saves now and returns the outcome that decides whether the server holds what the
 *   panels show: `"conflict"` once stopped, else the last save's outcome (`null` if none ran).
 * - `dispose()` only clears the timer (preflight F19): React Strict Mode's simulated unmount must
 *   not switch autosave off for the remounted editor.
 */
export function createAutosaver<T>(options: {
  readonly delayMs: number;
  readonly save: (value: T) => Promise<SaveOutcome>;
  readonly onState: (state: AutosaveState) => void;
}) {
  let pending: { readonly value: T } | null = null;
  let failed: { readonly value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;
  let last: SaveOutcome | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
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
    } else if (outcome === "error") {
      if (pending === null) failed = { value };
      options.onState("error");
    } else if (pending === null) {
      options.onState("saved");
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
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, options.delayMs);
    },
    async flush(): Promise<SaveOutcome | null> {
      clearTimer();
      if (running !== null) await running;
      clearTimer(); // a change made while waiting is saved now too
      if (!stopped && pending === null && failed !== null) {
        pending = failed;
        failed = null;
      }
      await drain();
      return stopped ? "conflict" : last;
    },
    dispose(): void {
      clearTimer();
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
 * Ruling 2: one Idempotency-Key per distinct request. The same request (same `fingerprint`: payload
 * plus `expectedVersion`, or the publish revision) keeps its key, so a retry after a lost response
 * replays the first answer instead of failing with a false `VERSION_CONFLICT`; any change, or
 * `reset()` after a final answer, makes a new key.
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
