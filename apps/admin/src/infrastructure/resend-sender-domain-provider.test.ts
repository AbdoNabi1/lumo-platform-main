import { describe, expect, it } from "vitest";
import { SenderDomainProviderError } from "@platform/notifications";
import { ResendSenderDomainProvider } from "./resend-sender-domain-provider";

const KEY = "re_domains_full_access_key";

const resendDomain = {
  id: "d91cd9bd-1176-453e-8fc1-35364d380206",
  name: "nusuj.example",
  status: "not_started",
  records: [
    {
      record: "DKIM",
      name: "resend._domainkey",
      type: "TXT",
      ttl: "Auto",
      status: "not_started",
      value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ",
    },
    {
      record: "SPF",
      name: "send",
      type: "MX",
      ttl: "Auto",
      status: "not_started",
      value: "feedback-smtp.us-east-1.amazonses.com",
      priority: 10,
    },
  ],
};

interface Seen {
  url: string;
  init: RequestInit;
}

function stub(respond: (seen: Seen) => Response | Promise<Response>) {
  const calls: Seen[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const seen = { url, init };
    calls.push(seen);
    return Promise.resolve(respond(seen));
  }) as typeof fetch;
  return { calls, provider: new ResendSenderDomainProvider({ apiKey: KEY, fetchImpl }) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function failureOf(run: () => Promise<unknown>): Promise<SenderDomainProviderError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SenderDomainProviderError) return error;
    throw error;
  }
  throw new Error("expected a SenderDomainProviderError");
}

describe("ResendSenderDomainProvider", () => {
  it("creates a domain: POST /domains {name} with the bearer key, records mapped", async () => {
    expect.hasAssertions();
    const { calls, provider } = stub(() => json(resendDomain, 201));
    const created = await provider.create("nusuj.example");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/domains");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>)["authorization"]).toBe(
      `Bearer ${KEY}`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ name: "nusuj.example" });
    expect(created).toEqual({
      providerDomainId: resendDomain.id,
      status: "not_started",
      records: [
        { ...resendDomain.records[0], priority: null },
        { ...resendDomain.records[1], priority: 10 },
      ],
    });
  });

  it("asks for verification with POST /domains/{id}/verify and reads GET /domains/{id}", async () => {
    expect.hasAssertions();
    const { calls, provider } = stub((seen) =>
      seen.init.method === "GET"
        ? json({ ...resendDomain, status: "verified" })
        : json({ object: "domain", id: resendDomain.id }),
    );
    await provider.verify(resendDomain.id);
    const fresh = await provider.get(resendDomain.id);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `POST https://api.resend.com/domains/${resendDomain.id}/verify`,
      `GET https://api.resend.com/domains/${resendDomain.id}`,
    ]);
    expect(fresh.status).toBe("verified");
  });

  it("reads an unknown status as pending, never as verified", async () => {
    expect.hasAssertions();
    const { provider } = stub(() => json({ ...resendDomain, status: "mystery" }));
    expect((await provider.get(resendDomain.id)).status).toBe("pending");
  });

  it("encodes the id into the path", async () => {
    expect.hasAssertions();
    const { calls, provider } = stub(() => json(resendDomain));
    await provider.get("a/b?c");
    expect(calls[0]?.url).toBe("https://api.resend.com/domains/a%2Fb%3Fc");
  });

  it("sends a 10 second abort signal on every call", async () => {
    expect.hasAssertions();
    const { calls, provider } = stub(() => json(resendDomain));
    await provider.get(resendDomain.id);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [400, "rejected"],
    [401, "rejected"],
    [403, "rejected"],
    [404, "rejected"],
    [422, "rejected"],
    [429, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)(
    "maps HTTP %i to a %s failure with no provider text and no key",
    async (status, failure) => {
      expect.hasAssertions();
      const { provider } = stub(() =>
        json(
          { name: "validation_error", message: `secret ${KEY} detail`, statusCode: status },
          status,
        ),
      );
      const error = await failureOf(() => provider.create("nusuj.example"));
      expect(error.failure).toBe(failure);
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain("secret");
      expect(error.message).not.toContain(String(status));
    },
  );

  it("maps a timeout and a network error", async () => {
    expect.hasAssertions();
    const timedOut = new ResendSenderDomainProvider({
      apiKey: KEY,
      fetchImpl: (() =>
        Promise.reject(
          new DOMException("The operation timed out", "TimeoutError"),
        )) as typeof fetch,
    });
    expect((await failureOf(() => timedOut.get("x"))).failure).toBe("timeout");

    const down = new ResendSenderDomainProvider({
      apiKey: KEY,
      fetchImpl: (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch,
    });
    expect((await failureOf(() => down.verify("x"))).failure).toBe("unavailable");
  });

  it("treats an answer that is not the expected shape as unavailable", async () => {
    expect.hasAssertions();
    const { provider } = stub(() => new Response("<html>oops</html>", { status: 200 }));
    expect((await failureOf(() => provider.create("nusuj.example"))).failure).toBe("unavailable");
    const noId = stub(() => json({ name: "nusuj.example" }));
    expect((await failureOf(() => noId.provider.get("x"))).failure).toBe("unavailable");
  });
});
