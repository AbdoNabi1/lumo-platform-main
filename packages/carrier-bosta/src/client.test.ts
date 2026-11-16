import { beforeEach, describe, expect, it, vi } from "vitest";
import cities from "./__fixtures__/cities.response.json";
import createResponse from "./__fixtures__/create-delivery.response.json";
import error3003 from "./__fixtures__/error.3003.modelled.json";
import searchList from "./__fixtures__/search.list.modelled.json";
import searchSingle from "./__fixtures__/search.single.json";
import { BostaClient, MASS_AWB_MAX, parseAwbResponse, parseSearchResponse } from "./client";
import type { HttpFetch } from "./http";

const expected = (): never => {
  throw new Error("expected a rejection");
};
beforeEach(() => {
  expect.hasAssertions();
});

const ok = (status: number, body: unknown) => ({
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
  arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer),
});
const client = (fetch: HttpFetch, baseUrl?: string) =>
  new BostaClient({ apiKey: "k", fetch, ...(baseUrl ? { baseUrl } : {}) });

describe("parseSearchResponse (U2)", () => {
  it("keeps only exact businessReference matches, from any recognised shape", () => {
    expect(parseSearchResponse(searchSingle, "12345678")).toEqual([
      { deliveryId: "Lx9vyKBqAeiIcERQKfn6I", trackingNumber: "5108002" },
    ]);
    expect(parseSearchResponse(searchSingle, "1234567")).toEqual([]);
    expect(
      parseSearchResponse({ data: { deliveries: [searchSingle.data] } }, "12345678"),
    ).toHaveLength(1);
    expect(
      parseSearchResponse({ data: [searchSingle.data, searchSingle.data] }, "12345678"),
    ).toHaveLength(2);
    expect(parseSearchResponse(searchList, "12345678")).toEqual([
      { deliveryId: "Lx9vyKBqAeiIcERQKfn6I", trackingNumber: "5108002" },
    ]);
    expect(parseSearchResponse({ data: [] }, "x")).toEqual([]);
    expect(parseSearchResponse({ data: { deliveries: [] } }, "x")).toEqual([]);
  });

  it("an unknown shape throws, never []", () => {
    const bad: unknown[] = [
      { success: false, data: [] },
      { data: null },
      { data: { list: [] } },
      { data: "text" },
      { data: 5 },
      { data: { _id: 5 } },
      null,
      "x",
      42,
    ];
    for (const body of bad) {
      expect(() => parseSearchResponse(body, "1001-1")).toThrow(
        expect.objectContaining({
          carrierFailure: "unavailable",
          message: "Bosta search response not recognised",
        }),
      );
    }
  });

  it("accepts a numeric tracking number and stringifies it", () => {
    expect(
      parseSearchResponse(
        { data: [{ businessReference: "1001-1", _id: "a", trackingNumber: 48089608 }] },
        "1001-1",
      ),
    ).toEqual([{ deliveryId: "a", trackingNumber: "48089608" }]);
  });

  it("an unreadable matching row is never treated as absence (plan review 1, finding 3)", () => {
    const unavailable = expect.objectContaining({ carrierFailure: "unavailable" });
    expect(() =>
      parseSearchResponse(
        { data: [{ businessReference: "1001-1", _id: "live", trackingNumber: null }] },
        "1001-1",
      ),
    ).toThrow(unavailable);
    expect(() =>
      parseSearchResponse(
        { data: [{ businessReference: "1001-1", _id: "", trackingNumber: "1" }] },
        "1001-1",
      ),
    ).toThrow(unavailable);
    expect(() =>
      parseSearchResponse(
        { data: [{ businessReference: "1001-1", _id: "a", trackingNumber: Infinity }] },
        "1001-1",
      ),
    ).toThrow(unavailable);
    expect(() => parseSearchResponse({ data: [42] }, "1001-1")).toThrow(unavailable);
    expect(() =>
      parseSearchResponse({ data: [{ _id: "a", trackingNumber: "1" }] }, "1001-1"),
    ).toThrow(unavailable);
    expect(
      parseSearchResponse(
        { data: [{ businessReference: "other", _id: "x", trackingNumber: "1" }] },
        "1001-1",
      ),
    ).toEqual([]);
  });
});

describe("parseAwbResponse (U1)", () => {
  it("rejects bytes that are neither a PDF nor a JSON envelope around one", () => {
    expect(MASS_AWB_MAX).toBe(50);
    const bytes = new TextEncoder().encode("{not json");
    expect(() => parseAwbResponse(bytes)).toThrow(
      expect.objectContaining({
        carrierFailure: "unavailable",
        message: "Bosta AWB response was not a PDF",
      }),
    );
  });
});

describe("BostaClient", () => {
  it("classifies errorCode given as a string the same as a number (F14)", async () => {
    const send = (errorCode: unknown) =>
      client(
        vi
          .fn<HttpFetch>()
          .mockResolvedValueOnce(ok(400, { success: false, message: "m", errorCode })),
      )
        .createDelivery({})
        .catch((e: unknown) => e);
    const numeric = await send(3003);
    expect(await send("3003")).toMatchObject({
      carrierFailure: "rejected",
      code: (numeric as { code: string }).code,
      reason: "DISTRICT_NOT_FOUND",
    });
  });

  it("maps the whole errorCode table", async () => {
    const table: [number | undefined, string, string | undefined][] = [
      [3001, "ADDRESS_NOT_SHIPPABLE", "CITY_NOT_FOUND"],
      [3002, "ADDRESS_NOT_SHIPPABLE", "ZONE_NOT_FOUND"],
      [3003, "ADDRESS_NOT_SHIPPABLE", "DISTRICT_NOT_FOUND"],
      [3004, "ADDRESS_NOT_SHIPPABLE", "STREET_NOT_FOUND"],
      [3009, "ADDRESS_NOT_SHIPPABLE", "ADDRESS_INCOMPLETE"],
      [3007, "COD_ABOVE_CARRIER_LIMIT", undefined],
      [2150, "OPEN_PACKAGE_NEEDS_IMAGES", undefined],
      [2151, "OPEN_PACKAGE_NEEDS_IMAGES", undefined],
      [2152, "OPEN_PACKAGE_NEEDS_IMAGES", undefined],
      [1073, "CARRIER_REJECTED", "NO_BUSINESS_LOCATION"],
      [1061, "CARRIER_REJECTED", undefined],
      [undefined, "CARRIER_REJECTED", undefined],
    ];
    for (const [errorCode, code, reason] of table) {
      for (const status of [400, 404, 422]) {
        const failure = await client(
          vi
            .fn<HttpFetch>()
            .mockResolvedValueOnce(ok(status, { success: false, message: "leak", errorCode })),
        )
          .createDelivery({})
          .then(expected, (e: unknown) => e as Error);
        expect(failure).toMatchObject({ carrierFailure: "rejected", status, code });
        expect((failure as { reason?: string }).reason).toBe(reason);
        expect(failure.message).not.toContain("leak");
      }
    }
  });

  it("treats 429/408 as unavailable and 3xx as unavailable, other 4xx as rejected", async () => {
    for (const [status, kind] of [
      [429, "unavailable"],
      [408, "unavailable"],
      [302, "unavailable"],
      [409, "rejected"],
    ] as const) {
      await expect(
        client(vi.fn<HttpFetch>().mockResolvedValueOnce(ok(status, {}))).createDelivery({}),
      ).rejects.toMatchObject({ carrierFailure: kind });
    }
  });

  it("an unrecognised create response is unavailable, never a made-up delivery", async () => {
    for (const body of [
      { success: true, data: {} },
      { success: true, data: { _id: "a", trackingNumber: null } },
      { success: true, data: null },
      [],
    ]) {
      await expect(
        client(vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, body))).createDelivery({}),
      ).rejects.toMatchObject({ carrierFailure: "unavailable" });
    }
    expect(
      await client(
        vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, createResponse)),
      ).createDelivery({}),
    ).toEqual({ deliveryId: "Lx9vyKBqAeiIcERQKfn6I", trackingNumber: "5108002" });
  });

  it("listCities sends countryId, keeps usable rows and refuses other shapes", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(ok(200, cities))
      .mockResolvedValueOnce(ok(200, { data: { list: [{ _id: 1 }, { _id: "a", name: "A" }] } }))
      .mockResolvedValueOnce(ok(200, { data: [] }));
    const api = client(fetch, "https://example.test/v2");
    const rows = await api.listCities("60e4482c7cb7d4bc4849c4d5");
    expect(fetch.mock.calls[0]![0]).toBe(
      "https://example.test/v2/cities?countryId=60e4482c7cb7d4bc4849c4d5",
    );
    expect(rows.map((row) => row._id)).toEqual(["Jrb6X6ucjiYgMP4T7", "FceDyHXwpSYYF9zGW"]);
    expect(rows[0]).toMatchObject({
      name: "Alexandria",
      nameAr: "الإسكندرية",
      dropOffAvailability: true,
    });
    expect(await api.listCities("x")).toEqual([{ _id: "a", name: "A" }]);
    await expect(api.listCities("x")).rejects.toMatchObject({ carrierFailure: "unavailable" });
  });

  it("searchByBusinessReference 401 is credentials_rejected; error bodies are never echoed", async () => {
    await expect(
      client(
        vi.fn<HttpFetch>().mockResolvedValueOnce(ok(401, error3003)),
      ).searchByBusinessReference("1001-1"),
    ).rejects.toMatchObject({ carrierFailure: "credentials_rejected", status: 401 });
  });

  it("getDelivery accepts a plain-string type and a numeric tracking number", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(
      ok(200, {
        success: true,
        data: { trackingNumber: 123, state: { code: 41, value: "Picked up" }, type: "RTO" },
      }),
    );
    expect(await client(fetch).getDelivery("123")).toEqual({
      trackingNumber: "123",
      stateCode: 41,
      stateLabel: "Picked up",
      type: "RTO",
    });
  });

  it("an unreadable body on a failure status still classifies by status", async () => {
    const failing: HttpFetch = () =>
      Promise.resolve({
        status: 400,
        text: () => Promise.reject(new Error("socket")),
        arrayBuffer: () => Promise.reject(new Error("socket")),
      });
    await expect(client(failing).createDelivery({})).rejects.toMatchObject({
      carrierFailure: "unavailable",
    });
  });
});
