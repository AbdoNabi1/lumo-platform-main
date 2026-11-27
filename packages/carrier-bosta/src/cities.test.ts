import { beforeEach, describe, expect, it, vi } from "vitest";
import { BostaCityDirectory, CITY_CACHE_TTL_MS, EGYPT_COUNTRY_ID } from "./cities";

beforeEach(() => {
  expect.hasAssertions();
});

const list = [{ _id: "c1", name: "Cairo" }];

describe("BostaCityDirectory", () => {
  it("exposes the Egypt country id and a 6 h TTL", () => {
    expect(EGYPT_COUNTRY_ID).toBe("60e4482c7cb7d4bc4849c4d5");
    expect(CITY_CACHE_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("caches per country id and refetches after the TTL", async () => {
    let now = 0;
    const directory = new BostaCityDirectory(() => now);
    const fetchList = vi.fn(() => Promise.resolve(list));
    expect(await directory.cities("eg", fetchList)).toBe(list);
    await directory.cities("eg", fetchList);
    expect(fetchList).toHaveBeenCalledTimes(1);
    await directory.cities("sa", fetchList);
    expect(fetchList).toHaveBeenCalledTimes(2);
    now = CITY_CACHE_TTL_MS - 1;
    await directory.cities("eg", fetchList);
    expect(fetchList).toHaveBeenCalledTimes(2);
    now = CITY_CACHE_TTL_MS + 1;
    await directory.cities("eg", fetchList);
    expect(fetchList).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight fetch and never caches a failure", async () => {
    const directory = new BostaCityDirectory();
    let release: (value: typeof list) => void = () => undefined;
    const slow = vi.fn(
      () =>
        new Promise<typeof list>((resolve) => {
          release = resolve;
        }),
    );
    const a = directory.cities("eg", slow);
    const b = directory.cities("eg", slow);
    release(list);
    expect(await a).toBe(list);
    expect(await b).toBe(list);
    expect(slow).toHaveBeenCalledTimes(1);

    const failing = new BostaCityDirectory();
    const fetchList = vi
      .fn<() => Promise<typeof list>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(list);
    await expect(failing.cities("eg", fetchList)).rejects.toThrow("down");
    expect(await failing.cities("eg", fetchList)).toBe(list);
    expect(fetchList).toHaveBeenCalledTimes(2);
  });
});
