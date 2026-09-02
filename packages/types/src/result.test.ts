import { describe, expect, it } from "vitest";
import { err, isErr, isOk, map, mapError, match, ok, unwrapOr } from "./result";

describe("Result helpers", () => {
  it("constructs and narrows ok/err", () => {
    const success = ok(42);
    const failure = err("boom");
    expect(isOk(success)).toBe(true);
    expect(isErr(failure)).toBe(true);
    if (isOk(success)) expect(success.value).toBe(42);
    if (isErr(failure)) expect(failure.error).toBe("boom");
  });

  it("maps the success channel only", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(map(err<string>("e"), (n: number) => n * 3)).toEqual({ ok: false, error: "e" });
  });

  it("maps the error channel only", () => {
    expect(mapError(err("e"), (e) => `${e}!`)).toEqual({ ok: false, error: "e!" });
    expect(mapError(ok(1), (e: string) => `${e}!`)).toEqual({ ok: true, value: 1 });
  });

  it("matches both channels", () => {
    expect(match(ok(1), { onOk: (v) => `ok:${v}`, onErr: (e) => `err:${String(e)}` })).toBe("ok:1");
    expect(match(err("x"), { onOk: (v) => `ok:${String(v)}`, onErr: (e) => `err:${e}` })).toBe(
      "err:x",
    );
  });

  it("unwraps with a fallback", () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err<string>("e"), 0)).toBe(0);
  });
});
