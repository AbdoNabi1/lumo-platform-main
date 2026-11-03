import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutosaver,
  createRequestKey,
  newClientKey,
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

  it("an error never retries on its own; the next flush retries the same value (F20)", async () => {
    const { saver, saved, states } = setup([async () => "error"]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saved).toEqual(["a"]); // no loop on a failing save (Ruling 3)
    expect(await saver.flush()).toBe("ok");
    expect(saved).toEqual(["a", "a"]);
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
