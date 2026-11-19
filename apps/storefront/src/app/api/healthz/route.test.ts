// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/healthz (preflight 27)", () => {
  it("answers 200 without calling anything, so a locked store or a down Runtime stays healthy", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
