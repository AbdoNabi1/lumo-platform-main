import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import type { StoreProfile } from "./messaging-ports";
import {
  DOMAIN_USED_BY_ANOTHER_STORE,
  GetSenderDomain,
  StartSenderDomain,
  VerifySenderDomain,
} from "./sender-domain.use-cases";
import {
  InMemoryNotificationSettingsRepository,
  InMemorySenderDomainRepository,
} from "../infrastructure/in-memory-messaging-repositories";
import { InMemorySenderDomainProvider } from "../infrastructure/in-memory-sender-domain-provider";
import { loadSenderContext } from "./messaging-support";
import { SenderDomainProviderError, type SenderDomainProvider } from "./sender-domain-ports";

const A = "tenant-a";
const B = "tenant-b";
const PLATFORM = "Morbeh <onboarding@resend.dev>";

function setup(
  options: {
    provider?: SenderDomainProvider | null;
    contactEmail?: string | null;
    senderEmail?: string | null;
  } = {},
) {
  const settings = new InMemoryNotificationSettingsRepository();
  const senderDomains = new InMemorySenderDomainRepository();
  const twin = new InMemorySenderDomainProvider();
  const provider = options.provider === null ? undefined : (options.provider ?? twin);
  let now = new Date("2026-11-26T10:00:00.000Z");
  const clock: Clock = { now: () => now };
  const contacts = new Map<string, string | null>([
    [A, options.contactEmail === undefined ? "hello@nusuj.example" : options.contactEmail],
    [B, "hi@other.example"],
  ]);
  const store = {
    get: (tenantId: string): Promise<StoreProfile> =>
      Promise.resolve({
        storeName: "Nusuj",
        contactEmail: contacts.get(tenantId) ?? null,
        defaultLocale: "en",
      }),
  };
  const deps = {
    settings,
    store,
    senderDomains,
    clock,
    ...(provider === undefined ? {} : { provider }),
  };
  if (options.senderEmail !== undefined && options.senderEmail !== null) {
    void settings.save(
      A,
      { senderEmail: options.senderEmail, staffRecipients: [], disabledTemplates: [] },
      null,
    );
  }
  return {
    settings,
    senderDomains,
    twin,
    contacts,
    advance: (to: string) => (now = new Date(to)),
    get: new GetSenderDomain(deps),
    start: new StartSenderDomain(deps),
    verify: new VerifySenderDomain(deps),
    resolve: (tenantId: string) =>
      loadSenderContext({ settings, store, senderDomains, platformFrom: PLATFORM }, tenantId),
  };
}

describe("StartSenderDomain", () => {
  it("registers the contact email's domain and keeps the DNS records", async () => {
    expect.hasAssertions();
    const { start, twin } = setup();
    const result = await start.execute({ tenantId: A });
    expect(result).toMatchObject({
      ok: true,
      value: {
        available: true,
        domain: {
          domain: "nusuj.example",
          status: "not_started",
          verified: false,
          verifiedAt: null,
        },
        suggestion: { domain: "nusuj.example", freeMail: false },
      },
    });
    if (result.ok) expect(result.value.domain?.records.length).toBeGreaterThan(0);
    expect(twin.calls).toEqual(["create:nusuj.example"]);
  });

  it("uses the sender email's domain before the contact email's", async () => {
    expect.hasAssertions();
    const { start } = setup({ senderEmail: "support@brand.example" });
    const result = await start.execute({ tenantId: A });
    expect(result).toMatchObject({ ok: true, value: { domain: { domain: "brand.example" } } });
  });

  it("is idempotent for the same store and domain: one provider call, same row", async () => {
    expect.hasAssertions();
    const { start, twin } = setup();
    await start.execute({ tenantId: A });
    const again = await start.execute({ tenantId: A });
    expect(again.ok).toBe(true);
    expect(twin.calls).toEqual(["create:nusuj.example"]);
  });

  it("refuses a free-mail address with the plain sentence, before any provider call", async () => {
    expect.hasAssertions();
    const { start, twin } = setup({ contactEmail: "shop@gmail.com" });
    const result = await start.execute({ tenantId: A });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "BUSINESS_RULE",
        message: "Emails from gmail.com can't be authenticated. Replies will still reach you.",
      },
    });
    expect(twin.calls).toEqual([]);
  });

  it("asks for a sender email when the store has neither a sender nor a contact email", async () => {
    expect.hasAssertions();
    const { start } = setup({ contactEmail: null });
    expect(await start.execute({ tenantId: A })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("answers NOT_CONFIGURED when there is no provider key", async () => {
    expect.hasAssertions();
    const { start, get } = setup({ provider: null });
    expect(await start.execute({ tenantId: A })).toMatchObject({
      ok: false,
      error: { code: "NOT_CONFIGURED", message: "Domain authentication isn't available yet" },
    });
    // Reading still works and says so.
    expect(await get.execute({ tenantId: A })).toMatchObject({
      ok: true,
      value: { available: false, domain: null },
    });
  });

  it("replaces an unverified domain when the store moves to another one", async () => {
    expect.hasAssertions();
    const { start, senderDomains, settings } = setup();
    await start.execute({ tenantId: A });
    await settings.save(
      A,
      { senderEmail: "support@brand.example", staffRecipients: [], disabledTemplates: [] },
      null,
    );
    const result = await start.execute({ tenantId: A });
    expect(result).toMatchObject({ ok: true, value: { domain: { domain: "brand.example" } } });
    expect(await senderDomains.find(A)).toMatchObject({ domain: "brand.example" });
    expect(await senderDomains.find(A)).not.toMatchObject({ domain: "nusuj.example" });
  });

  it("refuses another domain while the current one is verified", async () => {
    expect.hasAssertions();
    const { start, verify, twin, settings } = setup();
    await start.execute({ tenantId: A });
    twin.setStatus(twin.idOf("nusuj.example") ?? "", "verified");
    await verify.execute({ tenantId: A });
    await settings.save(
      A,
      { senderEmail: "support@brand.example", staffRecipients: [], disabledTemplates: [] },
      null,
    );
    const result = await start.execute({ tenantId: A });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "BUSINESS_RULE",
        message:
          "Your store already sends from nusuj.example. Only one domain per store is supported for now.",
      },
    });
    expect(twin.calls.filter((call) => call.startsWith("create:"))).toEqual([
      "create:nusuj.example",
    ]);
  });

  it("refuses a domain another store has verified, without calling the provider", async () => {
    expect.hasAssertions();
    const { start, senderDomains, twin, contacts } = setup();
    senderDomains.setVerified(B, ["nusuj.example"]);
    contacts.set(A, "hello@nusuj.example");
    const result = await start.execute({ tenantId: A });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "BUSINESS_RULE", message: DOMAIN_USED_BY_ANOTHER_STORE },
    });
    expect(twin.calls).toEqual([]);
    expect(await senderDomains.find(A)).toBeNull();
  });

  it.each(["rejected", "unavailable", "timeout"] as const)(
    "maps a provider %s failure to PROVIDER_ERROR with a plain message and stores nothing",
    async (failure) => {
      expect.hasAssertions();
      const { start, twin, senderDomains } = setup();
      twin.failNext(failure);
      const result = await start.execute({ tenantId: A });
      expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR" } });
      if (!result.ok) {
        expect(result.error.message).toBe(new SenderDomainProviderError(failure).message);
        expect(result.error.message).not.toMatch(/resend|re_|http|\d{3}/i);
      }
      expect(await senderDomains.find(A)).toBeNull();
    },
  );
});

describe("VerifySenderDomain", () => {
  it("verifies then reads the status, and stores status, records and verified_at", async () => {
    expect.hasAssertions();
    const { start, verify, twin, senderDomains, advance } = setup();
    await start.execute({ tenantId: A });
    const id = twin.idOf("nusuj.example") ?? "";

    const pending = await verify.execute({ tenantId: A });
    expect(pending).toMatchObject({
      ok: true,
      value: { domain: { status: "pending", verifiedAt: null } },
    });
    expect(twin.calls.slice(-2)).toEqual([`verify:${id}`, `get:${id}`]);

    twin.setStatus(id, "verified");
    advance("2026-11-26T11:00:00.000Z");
    const verified = await verify.execute({ tenantId: A });
    expect(verified).toMatchObject({
      ok: true,
      value: {
        domain: { status: "verified", verified: true, verifiedAt: "2026-11-26T11:00:00.000Z" },
      },
    });
    expect((await senderDomains.find(A))?.records.every((r) => r.status === "verified")).toBe(true);

    // Verifying again keeps the first verified_at.
    advance("2026-11-26T12:00:00.000Z");
    await verify.execute({ tenantId: A });
    expect((await senderDomains.find(A))?.verifiedAt?.toISOString()).toBe(
      "2026-11-26T11:00:00.000Z",
    );
  });

  it("clears verified_at when the provider no longer says verified", async () => {
    expect.hasAssertions();
    const { start, verify, twin, senderDomains } = setup();
    await start.execute({ tenantId: A });
    const id = twin.idOf("nusuj.example") ?? "";
    twin.setStatus(id, "verified");
    await verify.execute({ tenantId: A });
    twin.setStatus(id, "failed");
    const result = await verify.execute({ tenantId: A });
    expect(result).toMatchObject({
      ok: true,
      value: { domain: { status: "failed", verified: false, verifiedAt: null } },
    });
    expect((await senderDomains.find(A))?.verifiedAt).toBeNull();
  });

  it("answers NOT_CONFIGURED without a provider and NOT_FOUND before a domain was started", async () => {
    expect.hasAssertions();
    expect(await setup({ provider: null }).verify.execute({ tenantId: A })).toMatchObject({
      ok: false,
      error: { code: "NOT_CONFIGURED" },
    });
    expect(await setup().verify.execute({ tenantId: A })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it.each(["rejected", "unavailable", "timeout"] as const)(
    "maps a provider %s failure to PROVIDER_ERROR and leaves the stored row alone",
    async (failure) => {
      expect.hasAssertions();
      const { start, verify, twin, senderDomains } = setup();
      await start.execute({ tenantId: A });
      const before = await senderDomains.find(A);
      twin.failNext(failure);
      const result = await verify.execute({ tenantId: A });
      expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR" } });
      expect(await senderDomains.find(A)).toEqual(before);
    },
  );

  it("does not store verified when another store verified the same domain first", async () => {
    expect.hasAssertions();
    const { start, verify, twin, senderDomains } = setup();
    await start.execute({ tenantId: A });
    twin.setStatus(twin.idOf("nusuj.example") ?? "", "verified");
    senderDomains.setVerified(B, ["nusuj.example"]);
    const result = await verify.execute({ tenantId: A });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "BUSINESS_RULE", message: DOMAIN_USED_BY_ANOTHER_STORE },
    });
    expect((await senderDomains.find(A))?.status).toBe("not_started");
  });
});

describe("sender resolution reads the store's verified domains", () => {
  it("unverified or free-mail: Reply-To; verified: own domain; regression: back to Reply-To", async () => {
    expect.hasAssertions();
    const { start, verify, twin, resolve } = setup();
    await start.execute({ tenantId: A });
    expect(await resolve(A)).toMatchObject({
      sender: {
        mode: "reply_to",
        from: '"Nusuj" <onboarding@resend.dev>',
        replyTo: "hello@nusuj.example",
      },
    });

    const id = twin.idOf("nusuj.example") ?? "";
    twin.setStatus(id, "verified");
    await verify.execute({ tenantId: A });
    const own = await resolve(A);
    expect(own.sender).toMatchObject({ mode: "own_domain", from: '"Nusuj" <hello@nusuj.example>' });
    expect(own.sender.replyTo).toBeUndefined();
    // Another store is unaffected.
    expect((await resolve(B)).sender.mode).toBe("reply_to");

    twin.setStatus(id, "temporary_failure");
    await verify.execute({ tenantId: A });
    expect((await resolve(A)).sender).toMatchObject({
      mode: "reply_to",
      replyTo: "hello@nusuj.example",
      from: '"Nusuj" <onboarding@resend.dev>',
    });
  });
});

describe("GetSenderDomain", () => {
  it("reads the stored row and the suggestion without touching the provider", async () => {
    expect.hasAssertions();
    const { get, start, twin } = setup();
    expect(await get.execute({ tenantId: A })).toMatchObject({
      ok: true,
      value: {
        available: true,
        domain: null,
        suggestion: { domain: "nusuj.example", freeMail: false },
      },
    });
    await start.execute({ tenantId: A });
    const calls = twin.calls.length;
    expect(await get.execute({ tenantId: A })).toMatchObject({
      ok: true,
      value: { domain: { domain: "nusuj.example" } },
    });
    expect(twin.calls).toHaveLength(calls);
  });

  it("flags a free-mail suggestion so the page can explain it", async () => {
    expect.hasAssertions();
    const { get } = setup({ contactEmail: "shop@yahoo.co.uk" });
    expect(await get.execute({ tenantId: A })).toMatchObject({
      ok: true,
      value: { suggestion: { domain: "yahoo.co.uk", freeMail: true } },
    });
  });
});
