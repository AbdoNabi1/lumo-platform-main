import { afterEach, describe, expect, it, vi } from "vitest";
import { newItemId } from "./new-item-id";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("newItemId", () => {
  it("uses crypto.randomUUID when the browser has it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });
    expect(newItemId()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("falls back to getRandomValues on plain http, where randomUUID is undefined", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xff);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const id = newItemId();
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(id).toMatch(V4);
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("sets the version and variant bits whatever the random bytes are", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      },
    });
    expect(newItemId()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
