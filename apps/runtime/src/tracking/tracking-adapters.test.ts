import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  FetchHttpTransport,
  NodeHashPort,
  RuntimeTransportEnvelopeFactory,
  SecretCredentialResolver,
} from "./tracking-adapters";

describe("NodeHashPort", () => {
  it("digests UTF-8 input to lowercase SHA-256 hex", async () => {
    const hash = await new NodeHashPort().sha256Hex("طلب-1");
    expect(hash).toBe(createHash("sha256").update("طلب-1", "utf8").digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("SecretCredentialResolver", () => {
  const secrets = {
    get: (key: string) => ({ META_TOKEN: "tok", EMPTY: "" })[key],
    require: () => "",
  };
  const resolver = new SecretCredentialResolver(secrets);

  it("strips the vault:// scheme before looking the secret up", async () => {
    expect(await resolver.resolve("vault://META_TOKEN")).toBe("tok");
    expect(resolver.isAvailable("vault://META_TOKEN")).toBe(true);
  });

  it("passes a bare key through unchanged", async () => {
    expect(await resolver.resolve("META_TOKEN")).toBe("tok");
  });

  it("treats a missing or empty secret as unavailable, never as an empty credential", async () => {
    expect(await resolver.resolve("vault://MISSING")).toBeNull();
    expect(await resolver.resolve("vault://EMPTY")).toBeNull();
    expect(resolver.isAvailable("vault://MISSING")).toBe(false);
    expect(resolver.isAvailable("EMPTY")).toBe(false);
  });
});

describe("RuntimeTransportEnvelopeFactory", () => {
  it("mints a fresh request id and timestamp on every call", () => {
    let n = 0;
    let clock = 1_000;
    const factory = new RuntimeTransportEnvelopeFactory(
      { generate: () => `req-${String(++n)}` },
      () => clock,
    );

    const first = factory.create({ destination: "meta", eventId: "evt-1" });
    clock = 2_000;
    const retry = factory.create({ destination: "meta", eventId: "evt-1", credential: "tok" });

    expect(first).toEqual({
      requestId: "req-1",
      sentAtMs: 1_000,
      headers: { "x-request-id": "req-1", "x-request-timestamp": "1000", "x-destination": "meta" },
    });
    expect(retry.requestId).toBe("req-2");
    expect(retry.headers["x-request-timestamp"]).toBe("2000");
  });

  it("defaults to the wall clock", () => {
    const before = Date.now();
    const { sentAtMs } = new RuntimeTransportEnvelopeFactory({ generate: () => "r" }).create({
      destination: "meta",
      eventId: "e",
    });
    expect(sentAtMs).toBeGreaterThanOrEqual(before);
  });
});

describe("FetchHttpTransport", () => {
  const request = {
    url: "https://graph.example.test/events",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
    timeoutMs: 5_000,
  };

  it("returns the status and parsed JSON body of a successful response", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"events_received":1}', { status: 200 }));
    const result = await new FetchHttpTransport(fetchImpl as never).send(request);

    expect(result).toEqual({ status: 200, body: { events_received: 1 } });
    expect(fetchImpl).toHaveBeenCalledWith(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
      signal: expect.any(AbortSignal),
    });
  });

  it("omits the body from the request when there is none", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    const { body: _body, ...noBody } = request;
    const result = await new FetchHttpTransport(fetchImpl as never).send(noBody);

    expect(result).toEqual({ status: 204, body: {} });
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("returns a non-2xx status with a truncated error instead of throwing", async () => {
    const long = "x".repeat(500);
    const fetchImpl = vi.fn(async () => new Response(long, { status: 429 }));
    const result = await new FetchHttpTransport(fetchImpl as never).send(request);

    expect(result.status).toBe(429);
    expect(result.body).toBeUndefined();
    expect(result.error).toBe("x".repeat(200));
  });

  it("drops a JSON body that is not an object", async () => {
    const fetchImpl = vi.fn(async () => new Response("[1,2]", { status: 400 }));
    const result = await new FetchHttpTransport(fetchImpl as never).send(request);
    expect(result).toEqual({ status: 400, error: "[1,2]" });
  });

  it("surfaces a genuine transport failure as an error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(new FetchHttpTransport(fetchImpl as never).send(request)).rejects.toThrow(
      "fetch failed",
    );
  });

  it("aborts the request when the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const pending = new FetchHttpTransport(fetchImpl as never).send({
        ...request,
        timeoutMs: 50,
      });
      const assertion = expect(pending).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
