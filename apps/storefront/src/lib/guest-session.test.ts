import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const set = vi.fn((name: string, value: string) => void jar.set(name, value));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set,
  }),
}));
vi.mock("./runtime-api", () => ({}));

const { currentOrNewSessionRef } = await import("./guest-session");

beforeEach(() => {
  jar.clear();
  set.mockClear();
});

describe("currentOrNewSessionRef", () => {
  it("keeps the browser's guest session", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    expect(await currentOrNewSessionRef()).toBe("guest-1");
    expect(set).not.toHaveBeenCalled();
  });

  it("mints an HttpOnly guest session when there is none", async () => {
    const minted = await currentOrNewSessionRef();
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(set).toHaveBeenCalledWith(
      "morbeh-storefront-guest-session",
      minted,
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });
});
