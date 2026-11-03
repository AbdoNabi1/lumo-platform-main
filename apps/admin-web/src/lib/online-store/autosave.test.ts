import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutosaver,
  createReplayingSender,
  createRequestKey,
  newClientKey,
  type SendAnswer,
  type AutosaveState,
  type SaveOutcome,
} from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(outcomes: (() => Promise<SaveOutcome>)[] = []) {
  const saved: string[] = [];
  const states: AutosaveState[] = [];
  const saver = createAutosaver<string>({
    delayMs: 1000,
    save: (value) => {
      saved.push(value);
      return (outcomes.shift() ?? (async () => "ok"))();
    },
    onState: (s) => states.push(s),
  });
  return { saver, saved, states };
}

describe("createAutosaver (Decision 36)", () => {
  it("saves once, 1 s after the LAST change, with the latest value", async () => {
    const { saver, saved, states } = setup();
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(999);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(["b"]);
    expect(states).toEqual(["saving", "saved"]);
  });

  it("keeps one request in flight; a change made meanwhile saves right after", async () => {
    let release!: (o: SaveOutcome) => void;
    const { saver, saved } = setup([() => new Promise<SaveOutcome>((r) => (release = r))]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toEqual(["a"]);
    release("ok");
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(["a", "b"]);
  });

  it("stops on a conflict and ignores later changes", async () => {
    const { saver, saved, states } = setup([async () => "conflict"]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toEqual(["a"]);
    expect(states.at(-1)).toBe("conflict");
    expect(await saver.flush()).toBe("conflict");
  });

  it("flush saves now (used before Publish and Preview)", async () => {
    const { saver, saved } = setup();
    saver.schedule("a");
    await saver.flush();
    expect(saved).toEqual(["a"]);
  });

  it("flush returns the outcome: ok, or null when nothing was ever saved (preflight F20)", async () => {
    const { saver } = setup();
    expect(await saver.flush()).toBeNull();
    saver.schedule("a");
    expect(await saver.flush()).toBe("ok");
    expect(await saver.flush()).toBe("ok");
  });

  it("a 422 (invalid) never retries on its own; the next flush retries the same value (F20)", async () => {
    const { saver, saved, states } = setup([async () => "invalid"]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saved).toEqual(["a"]); // no loop on a refused save (Ruling 3)
    expect(saver.hasUnsaved()).toBe(true);
    expect(await saver.flush()).toBe("ok");
    expect(saved).toEqual(["a", "a"]);
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("a page-hide flush never resends a draft the server refused (422), only transient ones", async () => {
    const { saver, saved } = setup([async () => "invalid", async () => "error"]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await saver.flush({ includeRefused: false })).toBe("invalid");
    expect(saved).toEqual(["a"]);
    expect(saver.hasUnsaved()).toBe(true);
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(1000); // transient error
    expect(await saver.flush({ includeRefused: false })).toBe("ok");
    expect(saved).toEqual(["a", "b", "b"]);
  });

  it("a transient error retries with backoff, at most 3 times, then waits for flush (I-2)", async () => {
    const error = async (): Promise<SaveOutcome> => "error";
    const { saver, saved, states } = setup([error, error, error, error]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(saved).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(saved).toEqual(["a", "a", "a", "a"]);
    expect(states.at(-1)).toBe("error");
    expect(await saver.flush()).toBe("ok");
  });

  it("a retry that succeeds reports saved, and a new change restarts the retry budget", async () => {
    const { saver, saved, states } = setup([async () => "error"]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(3000);
    expect(saved).toEqual(["a", "a"]);
    expect(states.at(-1)).toBe("saved");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("a thrown save counts as an error, and flush reports it", async () => {
    const { saver } = setup([() => Promise.reject(new Error("network")), async () => "error"]);
    saver.schedule("a");
    expect(await saver.flush()).toBe("error");
  });

  it("a newer change replaces a failed value", async () => {
    const { saver, saved } = setup([async () => "error"]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule("b");
    expect(await saver.flush()).toBe("ok");
    expect(saved).toEqual(["a", "b"]);
  });

  it("flush during a save, with a newer change waiting on its timer, saves the newer value (M-7)", async () => {
    let release!: (o: SaveOutcome) => void;
    const { saver, saved } = setup([() => new Promise<SaveOutcome>((r) => (release = r))]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule("b");
    expect(saver.hasUnsaved()).toBe(true);
    const flushed = saver.flush();
    release("ok");
    expect(await flushed).toBe("ok");
    expect(saved).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toEqual(["a", "b"]);
  });

  it("dispose() only clears the timer: Strict Mode's simulated unmount keeps autosave on (F19)", async () => {
    const { saver, saved } = setup();
    saver.schedule("a");
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toEqual([]);
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual(["b"]);
  });
});

describe("createRequestKey (Ruling 2)", () => {
  it("keeps the key while the request is unchanged, and makes a new one when it changes", () => {
    let n = 0;
    const keys = createRequestKey(() => `key-${(n += 1)}`);
    expect(keys.keyFor("doc|6")).toBe("key-1");
    expect(keys.keyFor("doc|6")).toBe("key-1");
    expect(keys.keyFor("doc|7")).toBe("key-2");
    keys.reset();
    expect(keys.keyFor("doc|7")).toBe("key-3");
  });

  it("client keys are 32 hex characters and differ", () => {
    const a = newClientKey();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newClientKey()).not.toBe(a);
  });
});

/**
 * A tiny Runtime: optimistic version, a response cache per Idempotency-Key, and a switch that
 * commits a request but loses its response (the server-action blip I-1 is about).
 */
function fakeServer() {
  const server = {
    version: 1,
    saved: [] as string[],
    loseNext: false,
    calls: [] as { value: string; expectedVersion: number; key: string }[],
  };
  const cache = new Map<string, SendAnswer>();
  const send = (value: string, expectedVersion: number, key: string): Promise<SendAnswer> => {
    server.calls.push({ value, expectedVersion, key });
    const replay = cache.get(key);
    if (replay !== undefined) return Promise.resolve(replay);
    let answer: SendAnswer;
    if (expectedVersion !== server.version) answer = { status: "conflict" };
    else {
      server.version += 1;
      server.saved.push(value);
      answer = { status: "ok", version: server.version };
    }
    cache.set(key, answer);
    if (server.loseNext) {
      server.loseNext = false;
      return Promise.resolve({ status: "transient" });
    }
    return Promise.resolve(answer);
  };
  return { server, send };
}

describe("createReplayingSender (I-1)", () => {
  it("a lost response, then a new edit: the old request is replayed first, no false conflict", async () => {
    const { server, send } = fakeServer();
    const sender = createReplayingSender<string>({ initialVersion: 1, send });
    server.loseNext = true;
    expect(await sender.save("a")).toBe("error");
    expect(await sender.save("b")).toBe("ok");
    expect(server.saved).toEqual(["a", "b"]);
    expect(server.calls.map((c) => c.expectedVersion)).toEqual([1, 1, 2]);
    expect(server.calls[1]!.key).toBe(server.calls[0]!.key);
    expect(server.calls[2]!.key).not.toBe(server.calls[0]!.key);
  });

  it("through the autosaver with fake timers: lost response + new edit saves both, no conflict", async () => {
    const { server, send } = fakeServer();
    const sender = createReplayingSender<string>({ initialVersion: 1, send });
    const states: AutosaveState[] = [];
    const saver = createAutosaver<string>({
      delayMs: 1000,
      save: (v) => sender.save(v),
      onState: (s) => states.push(s),
    });
    server.loseNext = true;
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toBe("error");
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).not.toContain("conflict");
    expect(states.at(-1)).toBe("saved");
    expect(server.saved).toEqual(["a", "b"]);
  });

  it("re-sending the same value after a replayed 200 does not save it twice", async () => {
    const { server, send } = fakeServer();
    const sender = createReplayingSender<string>({ initialVersion: 1, send });
    server.loseNext = true;
    const value = "a";
    expect(await sender.save(value)).toBe("error");
    expect(await sender.save(value)).toBe("ok");
    expect(server.calls).toHaveLength(2);
    expect(server.saved).toEqual(["a"]);
  });

  it("an unresolved request that is still unanswered holds back the new value", async () => {
    const answers: SendAnswer[] = [{ status: "transient" }, { status: "transient" }];
    const calls: string[] = [];
    const sender = createReplayingSender<string>({
      initialVersion: 1,
      send: (value) => {
        calls.push(value);
        return Promise.resolve(answers.shift() ?? { status: "ok", version: 9 });
      },
    });
    expect(await sender.save("a")).toBe("error");
    expect(await sender.save("b")).toBe("error");
    expect(calls).toEqual(["a", "a"]);
  });

  it("a thrown send is transient; a 422 is final and not replayed; a real conflict is a conflict", async () => {
    const answers: (SendAnswer | Error)[] = [
      new Error("network"),
      { status: "invalid" },
      { status: "conflict" },
    ];
    const calls: string[] = [];
    const sender = createReplayingSender<string>({
      initialVersion: 1,
      send: (value) => {
        calls.push(value);
        const next = answers.shift()!;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    });
    expect(await sender.save("a")).toBe("error");
    expect(await sender.save("b")).toBe("conflict"); // replay of "a" is a 422, then "b" conflicts
    expect(calls).toEqual(["a", "a", "b"]);
  });

  it("a send that never settles times out as transient; the replay reconciles; a late answer is ignored", async () => {
    let lateResolve!: (a: SendAnswer) => void;
    const applied: string[] = [];
    const calls: { value: string; key: string }[] = [];
    const sender = createReplayingSender<string>({
      initialVersion: 1,
      timeoutMs: 25_000,
      send: (value, _version, key) => {
        calls.push({ value, key });
        if (calls.length === 1)
          return new Promise<SendAnswer>((resolve) => {
            lateResolve = resolve;
          });
        return Promise.resolve({
          status: "ok",
          version: calls.length + 1,
          apply: () => applied.push(value + calls.length),
        });
      },
    });
    const first = sender.save("a");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await first).toBe("error");
    // The stuck call answers late: its side effects must never run.
    lateResolve({ status: "ok", version: 2, apply: () => applied.push("late") });
    await vi.advanceTimersByTimeAsync(0);
    expect(await sender.save("b")).toBe("ok");
    expect(calls.map((c) => c.value)).toEqual(["a", "a", "b"]);
    expect(calls[1]!.key).toBe(calls[0]!.key);
    expect(applied).toEqual(["a2", "b3"]);
  });

  it("through the autosaver: a stuck save frees the queue, and flush does not hang", async () => {
    let n = 0;
    const sender = createReplayingSender<string>({
      initialVersion: 1,
      timeoutMs: 25_000,
      send: () => {
        n += 1;
        return n === 1
          ? new Promise<SendAnswer>(() => undefined)
          : Promise.resolve({ status: "ok", version: n + 1 });
      },
    });
    const states: AutosaveState[] = [];
    const saver = createAutosaver<string>({
      delayMs: 1000,
      save: (v) => sender.save(v),
      onState: (s) => states.push(s),
    });
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    const flushed = saver.flush();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await flushed).toBe("ok");
    expect(states).toContain("error");
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toBe("saved");
    expect(n).toBe(3);
  });
});
