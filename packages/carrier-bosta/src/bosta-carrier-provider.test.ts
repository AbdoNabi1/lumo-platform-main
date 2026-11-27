import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cities from "./__fixtures__/cities.response.json";
import createResponse from "./__fixtures__/create-delivery.response.json";
import error3003 from "./__fixtures__/error.3003.modelled.json";
import error401 from "./__fixtures__/error.401.json";
import getDelivery from "./__fixtures__/get-delivery.response.json";
import massAwb from "./__fixtures__/mass-awb.modelled.json";
import terminate404 from "./__fixtures__/terminate.404.json";
import terminateOk from "./__fixtures__/terminate.response.json";
import { BostaCityDirectory, CITY_CACHE_TTL_MS } from "./cities";
import { BostaClient } from "./client";
import { DEFAULT_BOSTA_CONFIG } from "./config";
import type { BostaParcel } from "./delivery-request";
import type { BostaRejectionCode } from "./errors";
import type { HttpFetch } from "./http";
import { BostaCarrierProvider } from "./provider";
import { mapBostaState } from "./states";

const expected = (): never => {
  throw new Error("expected a rejection");
};
beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  vi.useRealTimers();
});

const ok = (status: number, body: unknown) => ({
  status,
  text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  arrayBuffer: () =>
    Promise.resolve(
      new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body)).buffer,
    ),
});
const parcel = (over: Partial<BostaParcel> = {}): BostaParcel => ({
  recipient: { name: "Sasuke Uchiha", phone: "01065685435" },
  address: { line1: "Helwan street x", city: "Helwan", province: "EG-C", country: "EG" },
  codAmountMinor: 5000,
  currency: "EGP",
  itemsCount: 2,
  description: "Desc.",
  packageImages: [],
  ...over,
});
const bosta = (
  fetch: HttpFetch,
  options: {
    key?: string;
    directory?: BostaCityDirectory;
    webhookUrl?: string | null;
  } = {},
) =>
  new BostaCarrierProvider({
    client: new BostaClient({ apiKey: options.key ?? "bosta-api-key", fetch }),
    cities: options.directory ?? new BostaCityDirectory(),
    config: DEFAULT_BOSTA_CONFIG,
    webhookUrl:
      options.webhookUrl === undefined
        ? "https://api.example/api/v1/public/shipping/webhook/bosta"
        : options.webhookUrl,
    webhookHeaders: { "x-tenant-id": "t-1", Authorization: "s3cret" },
  });

describe("BostaCarrierProvider", () => {
  it("POSTs /deliveries?apiVersion=1 with the raw key and returns _id + trackingNumber (F1–F3)", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(ok(200, cities))
      .mockResolvedValueOnce(ok(200, createResponse));
    const provider = bosta(fetch);
    const created = await provider.createDelivery({ ...parcel(), reference: "1001-1" });
    expect(created).toEqual({ deliveryId: "Lx9vyKBqAeiIcERQKfn6I", trackingNumber: "5108002" });
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe("https://app.bosta.co/api/v2/deliveries?apiVersion=1");
    expect(init?.method).toBe("POST");
    expect(init?.headers?.Authorization).toBe("bosta-api-key");
    expect(init?.headers?.["Content-Type"]).toBe("application/json");
    expect(fetch.mock.calls[0]![0]).toBe(
      "https://app.bosta.co/api/v2/cities?countryId=60e4482c7cb7d4bc4849c4d5",
    );
    const body = JSON.parse(init!.body!) as Record<string, unknown>;
    expect(body.businessReference).toBe("1001-1");
    expect(body.webhookUrl).toBe("https://api.example/api/v1/public/shipping/webhook/bosta");
  });

  it("omits webhookUrl from the posted body when it is null", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(ok(200, cities))
      .mockResolvedValueOnce(ok(200, createResponse));
    await bosta(fetch, { webhookUrl: null }).createDelivery({ ...parcel(), reference: "1001-1" });
    const body = JSON.parse(fetch.mock.calls[1]![1]!.body!) as Record<string, unknown>;
    expect("webhookUrl" in body).toBe(false);
    expect("webhookCustomHeaders" in body).toBe(false);
  });

  it("3003 is ADDRESS_NOT_SHIPPABLE/DISTRICT_NOT_FOUND without the body (Review Focus 4)", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(ok(200, cities))
      .mockResolvedValueOnce(ok(400, error3003));
    const failure = await bosta(fetch)
      .createDelivery({ ...parcel(), reference: "1001-1" })
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({
      carrierFailure: "rejected",
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "DISTRICT_NOT_FOUND",
    });
    expect(String((failure as Error).message)).not.toContain(error3003.message);
    expect(String((failure as Error).message)).toBe(
      "Bosta refused the delivery (HTTP 400, errorCode 3003)",
    );
  });

  it("401 is credentials_rejected; 500, a timeout and non-JSON are unavailable", async () => {
    const run = async (response: ReturnType<typeof ok> | Error) => {
      const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, cities));
      if (response instanceof Error) fetch.mockRejectedValueOnce(response);
      else fetch.mockResolvedValueOnce(response);
      return bosta(fetch)
        .createDelivery({ ...parcel(), reference: "1001-1" })
        .then(expected, (e: unknown) => e as Error);
    };
    const unauthorized = await run(ok(401, error401));
    expect(unauthorized).toMatchObject({ carrierFailure: "credentials_rejected", status: 401 });
    expect(unauthorized.message).not.toContain(error401.message);
    expect(unauthorized.message).not.toContain("bosta-api-key");
    expect(
      await run(ok(500, { success: false, message: "boom secret", errorCode: 1000 })),
    ).toMatchObject({
      carrierFailure: "unavailable",
      status: 500,
    });
    expect(await run(ok(200, "<html>"))).toMatchObject({ carrierFailure: "unavailable" });
    const network = await run(new TypeError("fetch failed bosta-api-key"));
    expect(network).toMatchObject({ carrierFailure: "unavailable", status: 0, timedOut: false });
    expect(network.message).not.toContain("bosta-api-key");
    expect(await run(ok(200, { success: false, message: "x", errorCode: 3001 }))).toMatchObject({
      carrierFailure: "rejected",
      reason: "CITY_NOT_FOUND",
    });
  });

  it("aborts after 10 s and reports a timeout", async () => {
    vi.useFakeTimers();
    const hang: HttpFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const provider = bosta(hang);
    const pending = provider.verifyCredentials().then(expected, (e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(10_000);
    const failure = await pending;
    expect(failure).toMatchObject({ carrierFailure: "unavailable", status: 0, timedOut: true });
    expect(failure.message).toBe("Bosta request timed out");
  });

  it("prepare finds no city → ADDRESS_NOT_SHIPPABLE/CITY_NOT_FOUND, and makes no create call", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(ok(200, cities));
    const suez = parcel({
      address: { line1: "Helwan street x", city: "Helwan", province: "EG-SUZ", country: "EG" },
    });
    const provider = bosta(fetch);
    const problem: { readonly code: BostaRejectionCode; readonly reason?: string } | null =
      await provider.prepare(suez);
    expect(problem).toEqual({ code: "ADDRESS_NOT_SHIPPABLE", reason: "CITY_NOT_FOUND" });
    const failure = await bosta(fetch)
      .createDelivery({ ...suez, reference: "1001-1" })
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({
      carrierFailure: "rejected",
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "CITY_NOT_FOUND",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) expect(call[0]).toContain("/cities?countryId=");
  });

  it("prepare returns the parcel problem before touching the network, and null when fine", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(ok(200, cities));
    const provider = bosta(fetch);
    expect(await provider.prepare(parcel({ currency: "USD" }))).toEqual({
      code: "CURRENCY_NOT_SUPPORTED",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await provider.prepare(parcel())).toBeNull();
    expect(provider.key).toBe("bosta");
  });

  it("the city list is fetched once per country across two tenants' providers, and a failure is not cached", async () => {
    let now = 1_000;
    const directory = new BostaCityDirectory(() => now);
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(ok(200, cities));
    const one = bosta(fetch, { key: "key-one", directory });
    const two = bosta(fetch, { key: "key-two", directory });
    await one.prepare(parcel());
    await two.prepare(parcel());
    expect(fetch).toHaveBeenCalledTimes(1);
    now += CITY_CACHE_TTL_MS + 1;
    await two.prepare(parcel());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![1]?.headers?.Authorization).toBe("key-two");

    const flaky = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(ok(500, {}))
      .mockResolvedValueOnce(ok(200, cities));
    const fresh = bosta(flaky, { directory: new BostaCityDirectory(() => now) });
    await expect(fresh.prepare(parcel())).rejects.toMatchObject({ carrierFailure: "unavailable" });
    expect(await fresh.prepare(parcel())).toBeNull();
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("terminate: 200 cancelled, 404/1066 not_found, 400 or other 404 refused, 503 unavailable (F8, Ruling 1)", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, terminateOk));
    expect(await bosta(fetch).cancelDelivery("5108002")).toBe("cancelled");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://app.bosta.co/api/v2/deliveries/business/5108002/terminate");
    expect(init?.method).toBe("DELETE");
    expect(
      await bosta(vi.fn<HttpFetch>().mockResolvedValueOnce(ok(404, terminate404))).cancelDelivery(
        "5108002",
      ),
    ).toBe("not_found");
    for (const response of [ok(400, error3003), ok(404, { success: false, errorCode: 1000 })]) {
      await expect(
        bosta(vi.fn<HttpFetch>().mockResolvedValueOnce(response)).cancelDelivery("5108002"),
      ).rejects.toMatchObject({ carrierFailure: "rejected", code: "CARRIER_CANCEL_REFUSED" });
    }
    await expect(
      bosta(vi.fn<HttpFetch>().mockResolvedValueOnce(ok(503, {}))).cancelDelivery("5108002"),
    ).rejects.toMatchObject({ carrierFailure: "unavailable" });
  });

  it("mass-awb joins tracking numbers with commas, decodes base64 and refuses >50 (F12, U1)", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, massAwb));
    const pdf = await bosta(fetch).printAwbs(["77873113", "77873114"], {});
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf).toHaveLength(32);
    expect(fetch.mock.calls[0]![0]).toBe("https://app.bosta.co/api/v2/deliveries/mass-awb");
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body!)).toEqual({
      trackingNumbers: "77873113,77873114",
      requestedAwbType: "A6",
      lang: "ar",
    });
    await expect(
      bosta(fetch).printAwbs(
        Array.from({ length: 51 }, (_, i) => String(i)),
        {},
      ),
    ).rejects.toThrow(/50/);
    await expect(bosta(fetch).printAwbs([], {})).rejects.toThrow(/50|empty|1/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("mass-awb honours explicit format and language, and accepts raw and nested pdf bodies", async () => {
    const raw = "%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF";
    const b64 = massAwb.data;
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(ok(200, raw))
      .mockResolvedValueOnce(ok(200, { data: { data: b64 } }))
      .mockResolvedValueOnce(ok(200, { data: `data:application/pdf;base64,${b64}` }));
    const provider = bosta(fetch);
    const first = await provider.printAwbs(["1"], { format: "A4", lang: "en" });
    expect(new TextDecoder().decode(first)).toBe(raw);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body!)).toMatchObject({
      requestedAwbType: "A4",
      lang: "en",
    });
    expect(new TextDecoder().decode((await provider.printAwbs(["1"], {})).slice(0, 5))).toBe(
      "%PDF-",
    );
    expect(new TextDecoder().decode((await provider.printAwbs(["1"], {})).slice(0, 5))).toBe(
      "%PDF-",
    );
  });

  it("mass-awb rejects a non-PDF body as unavailable", async () => {
    for (const body of [{ data: "aGVsbG8=" }, { data: 5 }, { data: "!!!not base64" }, "plain"]) {
      const failure = await bosta(vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, body)))
        .printAwbs(["1"], {})
        .then(expected, (e: unknown) => e as Error);
      expect(failure).toMatchObject({ carrierFailure: "unavailable" });
      expect(failure.message).toBe("Bosta AWB response was not a PDF");
    }
  });

  it("verifyCredentials calls GET /pickup-locations and never parses the body (Ruling 8)", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, "not json"));
    await expect(bosta(fetch).verifyCredentials()).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://app.bosta.co/api/v2/pickup-locations");
    expect(init?.method).toBe("GET");
    expect(init?.headers?.Authorization).toBe("bosta-api-key");
    for (const status of [401, 403]) {
      await expect(
        bosta(vi.fn<HttpFetch>().mockResolvedValueOnce(ok(status, error401))).verifyCredentials(),
      ).rejects.toMatchObject({ carrierFailure: "credentials_rejected" });
    }
    await expect(
      bosta(vi.fn<HttpFetch>().mockResolvedValueOnce(ok(500, {}))).verifyCredentials(),
    ).rejects.toMatchObject({ carrierFailure: "unavailable" });
  });

  it("findDeliveriesByReference POSTs the search and keeps exact matches", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(ok(200, { data: [createResponse.data] }))
      .mockResolvedValueOnce(ok(401, error401));
    const provider = bosta(fetch);
    expect(await provider.findDeliveriesByReference("12345678")).toEqual([
      { deliveryId: "Lx9vyKBqAeiIcERQKfn6I", trackingNumber: "5108002" },
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://app.bosta.co/api/v2/deliveries/search");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body!)).toEqual({ businessReference: "12345678" });
    await expect(provider.findDeliveriesByReference("12345678")).rejects.toMatchObject({
      carrierFailure: "credentials_rejected",
    });
  });

  it("getDelivery maps the state through mapBostaState", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, getDelivery));
    const result = await bosta(fetch).getDelivery("710892");
    const mapped = mapBostaState(getDelivery.data.state.code, "SEND");
    expect(result).toEqual({
      trackingNumber: getDelivery.data.trackingNumber,
      stateCode: getDelivery.data.state.code,
      stateLabel: mapped.label,
      target: mapped.target,
    });
    expect(fetch.mock.calls[0]![0]).toBe("https://app.bosta.co/api/v2/deliveries/business/710892");
    expect(fetch.mock.calls[0]![1]?.method).toBe("GET");
    await expect(
      bosta(vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, { success: true, data: {} })))
        .getDelivery("1")
        .catch((e: unknown) => e),
    ).resolves.toMatchObject({ carrierFailure: "unavailable" });
  });
});
