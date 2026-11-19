import { ConcurrencyError, ValidationError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import type { WhatsAppConnectionRecord } from "../domain/repositories";
import { MetaApiError } from "../infrastructure/meta-graph-client";
import { deferred, flush } from "../testing/fake-ports";
import {
  createOutreachKit,
  seedConnection,
  seedContact,
  seedSendScenario,
  T1,
  T2,
  type OutreachKit,
} from "../testing/outreach-kit";
import { errorOf, okValue } from "../testing/result-helpers";
import { ConnectWhatsApp, ONBOARDING_LEASE_MS } from "./connect-whatsapp.use-case";
import {
  AbandonWhatsAppOnboarding,
  DisconnectWhatsApp,
  GetWhatsAppConnection,
  RefreshWhatsAppStatus,
} from "./connection.use-cases";
import { SendWhatsAppSessionMessage, SendWhatsAppTemplate } from "./send.use-cases";
import { ProcessWhatsAppWebhook } from "./webhook.use-case";
import { messagesPayload, seconds, textMessage } from "../testing/webhook-fixtures";

const input = (over: Record<string, unknown> = {}) => ({
  tenantId: T1,
  code: "code-1",
  wabaId: "waba-1",
  phoneNumberId: "phone-1",
  ...over,
});
const connect = (kit: OutreachKit, over: Record<string, unknown> = {}) =>
  new ConnectWhatsApp(kit.deps).execute(input(over));
const row = async (kit: OutreachKit, tenantId = T1): Promise<WhatsAppConnectionRecord> => {
  const r = await kit.mem.connections.get(tenantId);
  if (r === null) throw new Error("no connection row");
  return r;
};
const registerPins = (kit: OutreachKit): string[] =>
  kit.whatsapp.callsOf("registerPhone").map((a) => a[1] as string);
const metaError = (code: string, status = 400): MetaApiError =>
  new MetaApiError(code, "provider text", status);
const sleepPast = (kit: OutreachKit): void => kit.clock.advance(ONBOARDING_LEASE_MS + 1000);

describe("GetWhatsAppConnection", () => {
  it("reports not_connected with the availability of the platform ports", async () => {
    expect.hasAssertions();
    const on = okValue(
      await new GetWhatsAppConnection(createOutreachKit().deps).execute({ tenantId: T1 }),
    );
    expect(on).toMatchObject({
      available: true,
      status: "not_connected",
      version: 0,
      connectedAt: null,
    });
    const off = okValue(
      await new GetWhatsAppConnection(createOutreachKit({ configured: false }).deps).execute({
        tenantId: T1,
      }),
    );
    expect(off.available).toBe(false);
  });

  it("never exposes credentials and only allowlisted failure codes", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit, { token: "SECRET-TOKEN", pin: "424242" });
    await kit.mem.connections.save(
      { ...conn, lastError: "boom: provider text!", onboardingFailure: "META_190" },
      conn.version,
    );
    const dto = okValue(await new GetWhatsAppConnection(kit.deps).execute({ tenantId: T1 }));
    const json = JSON.stringify(dto);
    expect(json).not.toContain("SECRET-TOKEN");
    expect(json).not.toContain("424242");
    expect(json).not.toContain("sealed");
    expect(dto).toMatchObject({
      status: "connected",
      lastError: null,
      onboardingFailure: "META_190",
      displayPhoneNumber: "+20 101 234 5678",
    });
  });
});

describe("ConnectWhatsApp — new connection", () => {
  it("runs exchange → membership → subscribe → register → getPhone and finalizes in one go", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const dto = okValue(await connect(kit));
    expect(kit.whatsapp.calls.map((c) => c.method)).toEqual([
      "exchangeCode",
      "listPhoneNumberIds",
      "subscribeApp",
      "registerPhone",
      "getPhone",
    ]);
    expect(registerPins(kit)).toEqual(["123456"]);
    expect(dto).toMatchObject({
      status: "connected",
      displayPhoneNumber: "+20 101 234 5678",
      verifiedName: "Shop",
      onboardingFailure: null,
      onboardingStage: "registered",
    });
    const stored = await row(kit);
    expect(stored).toMatchObject({
      status: "connected",
      onboardingLeaseOwner: null,
      onboardingLeaseUntil: null,
      lastError: null,
    });
    expect(await kit.vault.open(T1, "whatsapp", stored.sealedCredentials)).toEqual({
      accessToken: "token-code-1",
      pin: "123456",
    });
    expect(await kit.mem.directory.find("phone-1")).toEqual({ shopTenantId: T1, wabaId: "waba-1" });
    const events = kit.events.ofType("outreach.whatsapp.connected");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      phoneNumberId: "phone-1",
      wabaId: "waba-1",
      displayPhoneNumber: "+20 101 234 5678",
    });
    expect(JSON.stringify(events)).not.toContain("token-code-1");
  });

  it("refuses without ports and validates the input before any call", async () => {
    expect.hasAssertions();
    expect(errorOf(await connect(createOutreachKit({ configured: false }))).message).toBe(
      "WHATSAPP_NOT_CONFIGURED",
    );
    const kit = createOutreachKit();
    for (const over of [{ code: "" }, { wabaId: " " }, { phoneNumberId: "x".repeat(300) }]) {
      expect(errorOf(await connect(kit, over))).toBeInstanceOf(ValidationError);
    }
    expect(kit.whatsapp.total).toBe(0);
  });

  it("an onboarding row with null identity fields is persisted before getPhone", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    let seen: WhatsAppConnectionRecord | null = null;
    kit.whatsapp.set("getPhone", async () => {
      seen = await kit.mem.connections.get(T1);
      return {
        phoneNumberId: "phone-1",
        displayPhoneNumber: "+20 1",
        verifiedName: "Shop",
        qualityRating: null,
        messagingLimitTier: null,
      };
    });
    okValue(await connect(kit));
    expect(seen).toMatchObject({
      status: "onboarding",
      displayPhoneNumber: null,
      verifiedName: null,
      connectedAt: null,
      onboardingStage: "registered",
    });
  });

  it("PHONE_IN_USE / WABA_IN_USE from the directory precheck cost zero Meta calls", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await kit.mem.directory.claim("phone-1", "waba-1", T2);
    expect(errorOf(await connect(kit)).message).toBe("PHONE_IN_USE");
    expect(errorOf(await connect(kit, { phoneNumberId: "phone-9" })).message).toBe("WABA_IN_USE");
    // the same phone with a changed WABA is still another shop's phone
    expect(errorOf(await connect(kit, { wabaId: "waba-9" })).message).toBe("PHONE_IN_USE");
    expect(kit.whatsapp.total).toBe(0);
    expect(await kit.mem.connections.get(T1)).toBeNull();
  });

  it("an asset mismatch (the phone is not in the WABA) persists no connection and makes no mutation", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.phoneIds = ["other-phone"];
    expect(errorOf(await connect(kit)).message).toBe("META_ASSET_MISMATCH");
    expect(kit.whatsapp.mutations).toBe(0);
    expect(await kit.mem.directory.find("phone-1")).toBeNull();
    expect(await row(kit)).toMatchObject({
      status: "onboarding",
      onboardingFailure: "META_ASSET_MISMATCH",
      sealedCredentials: "",
    });
  });

  it("a seal failure makes no remote mutation", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.vault.failSeal = true;
    expect(errorOf(await connect(kit)).message).toBe("CREDENTIALS_UNAVAILABLE");
    expect(kit.whatsapp.mutations).toBe(0);
    expect(await row(kit)).toMatchObject({ status: "onboarding", sealedCredentials: "" });
  });

  it("a Meta exchange failure is META_<code>, mutates nothing and records the code only", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.set("exchangeCode", () => {
      throw metaError("190", 401);
    });
    expect(errorOf(await connect(kit)).message).toBe("META_190");
    expect(kit.whatsapp.mutations).toBe(0);
    expect(await kit.mem.directory.find("phone-1")).toBeNull();
    expect((await row(kit)).onboardingFailure).toBe("META_190");
  });

  it("a PIN rejection by Meta (133005) tells the merchant to reconcile, and keeps stage and PIN", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.set("registerPhone", () => {
      throw metaError("133005");
    });
    expect(errorOf(await connect(kit)).message).toBe("ONBOARDING_RECONCILIATION_REQUIRED");
    expect(await row(kit)).toMatchObject({
      status: "onboarding",
      onboardingStage: "registering",
      onboardingFailure: "ONBOARDING_RECONCILIATION_REQUIRED",
    });
    const dto = okValue(await new GetWhatsAppConnection(kit.deps).execute({ tenantId: T1 }));
    expect(dto).toMatchObject({
      status: "onboarding",
      onboardingFailure: "ONBOARDING_RECONCILIATION_REQUIRED",
    });
  });

  it("a rate-limited register is a failure (not a success) and never advances the stage", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.set("registerPhone", () => {
      throw metaError("HTTP_429", 429);
    });
    expect(errorOf(await connect(kit)).message).toBe("META_HTTP_429");
    expect((await row(kit)).onboardingStage).toBe("registering");
  });

  it("the lease is released when a failure is recorded", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.set("subscribeApp", () => {
      throw metaError("100");
    });
    errorOf(await connect(kit));
    expect(await row(kit)).toMatchObject({
      onboardingLeaseOwner: null,
      onboardingLeaseUntil: null,
      onboardingStage: "verified",
    });
  });
});

describe("ConnectWhatsApp — resume", () => {
  it("getPhone failing after register keeps the PIN; the resume makes ZERO register calls and reuses it", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("getPhone", () => {
      throw metaError("500", 500);
    });
    expect(errorOf(await connect(kit)).message).toBe("META_500");
    expect(await row(kit)).toMatchObject({ status: "onboarding", onboardingStage: "registered" });
    okValue(await connect(kit, { code: "code-2" }));
    expect(kit.whatsapp.count("registerPhone")).toBe(1);
    expect(kit.whatsapp.count("subscribeApp")).toBe(1);
    const stored = await row(kit);
    expect(await kit.vault.open(T1, "whatsapp", stored.sealedCredentials)).toEqual({
      accessToken: "token-code-2",
      pin: "123456",
    });
  });

  it("registered → getPhone fails → resume → fails → resume: no register call after the first and no new PIN", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("getPhone", () => {
      throw metaError("500", 500);
    });
    kit.whatsapp.once("getPhone", () => {
      throw metaError("500", 500);
    });
    errorOf(await connect(kit));
    const pinsLeft = kit.pins.length;
    errorOf(await connect(kit, { code: "c2" }));
    okValue(await connect(kit, { code: "c3" }));
    expect(kit.whatsapp.count("registerPhone")).toBe(1);
    expect(kit.pins).toHaveLength(pinsLeft);
    expect(registerPins(kit)).toEqual(["123456"]);
  });

  it("a lost register response, then resume → register again with the same PIN, exactly once more", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("registerPhone", () => {
      throw metaError("TIMEOUT", 0);
    });
    expect(errorOf(await connect(kit)).message).toBe("META_TIMEOUT");
    expect((await row(kit)).onboardingStage).toBe("registering");
    okValue(await connect(kit, { code: "c2" }));
    expect(registerPins(kit)).toEqual(["123456", "123456"]);
    expect(kit.whatsapp.count("subscribeApp")).toBe(1);
  });

  it("a lost registered-stage write → the resume makes the same-PIN call", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const real = kit.mem.connections;
    let crash = true;
    kit.deps.connections = new Proxy(real, {
      get(target, prop) {
        // Owner writes go through the conditional `writeAsLeaseOwner` since the lease is checked at write time.
        if (prop === "writeAsLeaseOwner") {
          return (...args: Parameters<typeof real.writeAsLeaseOwner>) => {
            if (
              crash &&
              args[0].status === "onboarding" &&
              args[0].onboardingStage === "registered"
            ) {
              crash = false;
              return Promise.reject(new Error("db down"));
            }
            return target.writeAsLeaseOwner(...args);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    await expect(connect(kit)).rejects.toThrow("db down");
    expect((await row(kit)).onboardingStage).toBe("registering");
    sleepPast(kit);
    okValue(await connect(kit, { code: "c2" }));
    expect(registerPins(kit)).toEqual(["123456", "123456"]);
  });

  it("a lease that expires after the use case's own check but before the write executes: the write is refused and nothing changes", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const real = kit.mem.connections;
    let expireOnce = true;
    kit.deps.connections = new Proxy(real, {
      get(target, prop) {
        if (prop === "writeAsLeaseOwner") {
          return (...args: Parameters<typeof real.writeAsLeaseOwner>) => {
            // the use case read the row while its lease was live; the clock passes the expiry before the write runs
            if (expireOnce) {
              expireOnce = false;
              kit.clock.advance(ONBOARDING_LEASE_MS + 1);
            }
            return target.writeAsLeaseOwner(...args);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    expect(errorOf(await connect(kit)).message).toBe("CONNECTION_CHANGED");
    const stored = await row(kit);
    // only the acquire wrote: the version, stage and the (now expired) lease are exactly as the acquire left them
    expect(stored).toMatchObject({ version: 1, onboardingStage: null, status: "onboarding" });
    expect(kit.whatsapp.count("subscribeApp")).toBe(0);
    expect(kit.whatsapp.count("registerPhone")).toBe(0);
  });

  it("a resume with an unusable code continues with the sealed token", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("subscribeApp", () => {
      throw metaError("100");
    });
    errorOf(await connect(kit));
    kit.whatsapp.set("exchangeCode", () => {
      throw metaError("100");
    });
    okValue(await connect(kit, { code: "stale" }));
    const subscribeTokens = kit.whatsapp.callsOf("subscribeApp").map((a) => a[1]);
    expect(subscribeTokens).toEqual(["token-code-1", "token-code-1"]);
  });

  it("a resume at 'verified' subscribes then registers; a resume at 'subscribed' registers only", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("registerPhone", () => {
      throw metaError("100");
    });
    errorOf(await connect(kit));
    expect((await row(kit)).onboardingStage).toBe("registering");
    const sub = createOutreachKit();
    sub.whatsapp.once("subscribeApp", () => {
      throw metaError("100");
    });
    errorOf(await connect(sub));
    okValue(await connect(sub, { code: "c2" }));
    expect(sub.whatsapp.count("subscribeApp")).toBe(2);
    expect(sub.whatsapp.count("registerPhone")).toBe(1);
  });
});

describe("ConnectWhatsApp — reconnect, switch and blocked", () => {
  it("a same-asset connected reconnect keeps the PIN and the first connect time", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit, { pin: "777777" });
    const first = conn.connectedAt;
    kit.clock.advance(3_600_000);
    const pinsLeft = kit.pins.length;
    okValue(await connect(kit, { code: "again" }));
    expect(registerPins(kit)).toEqual(["777777"]);
    expect(kit.pins).toHaveLength(pinsLeft);
    expect((await row(kit)).connectedAt?.getTime()).toBe(first?.getTime());
    expect((await row(kit)).status).toBe("connected");
  });

  it("a failed reconnect leaves the connection usable (still connected)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("subscribeApp", () => {
      throw metaError("100");
    });
    expect(errorOf(await connect(kit)).message).toBe("META_100");
    expect(await row(kit)).toMatchObject({
      status: "connected",
      onboardingFailure: "META_100",
      onboardingLeaseOwner: null,
    });
    expect(await kit.mem.directory.find("phone-1")).not.toBeNull();
  });

  it("connected A → onboarding B → remote failure: no directory row for A or B, and sends are refused", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    kit.whatsapp.phoneIds = ["phone-1", "phone-2"];
    kit.whatsapp.set("subscribeApp", () => {
      throw metaError("100");
    });
    expect(
      errorOf(await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" })).message,
    ).toBe("META_100");
    expect(await row(kit)).toMatchObject({
      status: "onboarding",
      phoneNumberId: "phone-2",
      wabaId: "waba-2",
    });
    expect(await kit.mem.directory.find("phone-1")).toBeNull();
    expect(await kit.mem.directory.find("phone-2")).toBeNull();
    const send = await new SendWhatsAppTemplate(kit.deps).execute({
      tenantId: T1,
      to: "01012345678",
      templateName: "cod_confirmation_ar",
      language: "ar",
      values: { body: ["x"] },
      idempotencyKey: "after-switch",
    });
    expect(errorOf(send).message).toBe("WHATSAPP_NOT_CONNECTED");
  });

  it("an exchange failure while switching leaves connection A untouched", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("exchangeCode", () => {
      throw metaError("190", 401);
    });
    errorOf(await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" }));
    expect(await row(kit)).toMatchObject({ status: "connected", phoneNumberId: "phone-1" });
    expect(await kit.mem.directory.find("phone-1")).not.toBeNull();
  });

  it("A → B succeeds: the directory moves to B and A is released", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.phoneIds = ["phone-2"];
    okValue(await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" }));
    expect(await kit.mem.directory.find("phone-1")).toBeNull();
    expect(await kit.mem.directory.find("phone-2")).toEqual({ shopTenantId: T1, wabaId: "waba-2" });
    expect(await row(kit)).toMatchObject({
      status: "connected",
      phoneNumberId: "phone-2",
      wabaId: "waba-2",
    });
    expect(registerPins(kit)).toHaveLength(1);
    expect(kit.pins[0]).toBe("654321");
  });

  it("a failed claim rolls back the release of the shop's previous directory row", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await kit.mem.directory.claim("phone-old", "waba-old", T1);
    kit.whatsapp.set("getPhone", async () => {
      await kit.mem.directory.claim("phone-1", "waba-x", T2);
      return {
        phoneNumberId: "phone-1",
        displayPhoneNumber: "+20 1",
        verifiedName: "Shop",
        qualityRating: null,
        messagingLimitTier: null,
      };
    });
    expect(errorOf(await connect(kit)).message).toBe("PHONE_IN_USE");
    expect(await kit.mem.directory.find("phone-old")).toEqual({
      shopTenantId: T1,
      wabaId: "waba-old",
    });
    expect(await kit.mem.directory.find("phone-1")).toEqual({ shopTenantId: T2, wabaId: "waba-x" });
    expect(await row(kit)).toMatchObject({
      status: "onboarding",
      onboardingFailure: "PHONE_IN_USE",
      onboardingLeaseOwner: null,
    });
    expect(kit.events.ofType("outreach.whatsapp.connected")).toHaveLength(0);
  });

  it("two shops racing for one phone: exactly one is connected", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const [a, b] = await Promise.all([
      connect(kit, { tenantId: T1, wabaId: "waba-a" }),
      connect(kit, { tenantId: T2, wabaId: "waba-b" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(errorOf(loser).message).toBe("PHONE_IN_USE");
    const owner = await kit.mem.directory.find("phone-1");
    expect(owner?.shopTenantId).toBe(a.ok ? T1 : T2);
    expect(kit.events.ofType("outreach.whatsapp.connected")).toHaveLength(1);
  });

  it("an onboarding row for DIFFERENT assets is blocked at every stage with zero Meta calls, until Cancel setup", async () => {
    expect.hasAssertions();
    for (const stage of ["verified", "subscribed", "registering", "registered"] as const) {
      const kit = createOutreachKit();
      const seeded = await seedConnection(kit, {
        status: "onboarding",
        phoneNumberId: "phone-1",
        wabaId: "waba-1",
      });
      await kit.mem.connections.save(
        { ...seeded, onboardingStage: stage, onboardingAttemptId: "att-1" },
        seeded.version,
      );
      expect(
        errorOf(await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" })).message,
      ).toBe("ONBOARDING_RECONCILIATION_REQUIRED");
      expect(kit.whatsapp.total).toBe(0);
    }
  });

  it("Abandon → a new attempt (new PIN) succeeds", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("registerPhone", () => {
      throw metaError("133005");
    });
    errorOf(await connect(kit));
    const blocked = await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" });
    expect(errorOf(blocked).message).toBe("ONBOARDING_RECONCILIATION_REQUIRED");
    const abandoned = okValue(
      await new AbandonWhatsAppOnboarding(kit.deps).execute({
        tenantId: T1,
        expectedVersion: (await row(kit)).version,
      }),
    );
    expect(abandoned.status).toBe("disconnected");
    expect(await row(kit)).toMatchObject({
      sealedCredentials: "",
      onboardingAttemptId: null,
      onboardingStage: null,
      onboardingLeaseOwner: null,
    });
    kit.whatsapp.phoneIds = ["phone-2"];
    okValue(await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" }));
    expect(registerPins(kit)).toEqual(["123456", "654321"]);
  });
});

describe("ConnectWhatsApp — exclusive ownership (lease)", () => {
  async function blockedAtRegister(kit: OutreachKit) {
    const gate = deferred<void>();
    kit.whatsapp.once("registerPhone", () => gate.promise);
    const a = connect(kit);
    await flush();
    expect(kit.whatsapp.count("registerPhone")).toBe(1);
    return { gate, a };
  }

  it("A holds the lease at register; B's resume is ONBOARDING_IN_PROGRESS with zero Meta calls; A completes", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { gate, a } = await blockedAtRegister(kit);
    const before = kit.whatsapp.total;
    expect(errorOf(await connect(kit, { code: "b" })).message).toBe("ONBOARDING_IN_PROGRESS");
    expect(kit.whatsapp.total).toBe(before);
    gate.resolve();
    expect(okValue(await a).status).toBe("connected");
    expect(kit.whatsapp.count("registerPhone")).toBe(1);
  });

  it("A crashes holding the lease: refused before expiry, then exactly one same-PIN register after it", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("registerPhone", () => {
      throw new Error("process died");
    });
    await expect(connect(kit)).rejects.toThrow("process died");
    expect((await row(kit)).onboardingLeaseOwner).not.toBeNull();
    const before = kit.whatsapp.total;
    expect(errorOf(await connect(kit, { code: "b" })).message).toBe("ONBOARDING_IN_PROGRESS");
    expect(kit.whatsapp.total).toBe(before);
    sleepPast(kit);
    okValue(await connect(kit, { code: "b" }));
    expect(registerPins(kit)).toEqual(["123456", "123456"]);
    expect(kit.whatsapp.count("subscribeApp")).toBe(1);
  });

  it("A loses its lease (the clock passes expiry and C acquires it): A's next write fails and A makes no further calls", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { gate, a } = await blockedAtRegister(kit);
    sleepPast(kit);
    const c = await connect(kit, { code: "c" });
    expect(okValue(c).status).toBe("connected");
    const callsBeforeA = kit.whatsapp.total;
    gate.resolve();
    expect(errorOf(await a).message).toBe("CONNECTION_CHANGED");
    expect(kit.whatsapp.total).toBe(callsBeforeA);
    expect(await row(kit)).toMatchObject({ status: "connected", onboardingLeaseOwner: null });
  });

  it("a competing caller whose CAS fails stops with zero remote calls (two simultaneous starts)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const [a, b] = await Promise.all([connect(kit), connect(kit)]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(errorOf(results.find((r) => !r.ok) ?? a).message).toMatch(
      /ONBOARDING_IN_PROGRESS|CONNECTION_CHANGED/,
    );
    expect(kit.whatsapp.count("registerPhone")).toBe(1);
    expect(kit.whatsapp.count("exchangeCode")).toBe(1);
  });

  it("a disconnect while A is mid-flight makes A stop (no stale connect)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { gate, a } = await blockedAtRegister(kit);
    okValue(
      await new AbandonWhatsAppOnboarding(kit.deps).execute({
        tenantId: T1,
        expectedVersion: (await row(kit)).version,
      }),
    );
    gate.resolve();
    expect(errorOf(await a).message).toBe("CONNECTION_CHANGED");
    expect((await row(kit)).status).toBe("disconnected");
    expect(await kit.mem.directory.find("phone-1")).toBeNull();
  });
});

describe("RefreshWhatsAppStatus", () => {
  it("updates quality and tier", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("getPhone", () => ({
      phoneNumberId: "phone-1",
      displayPhoneNumber: "+20 101 234 5678",
      verifiedName: "Shop",
      qualityRating: "YELLOW",
      messagingLimitTier: "TIER_2K",
    }));
    const dto = okValue(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 }));
    expect(dto).toMatchObject({
      qualityRating: "YELLOW",
      messagingLimitTier: "TIER_2K",
      status: "connected",
      lastError: null,
    });
    expect((await row(kit)).lastStatusSyncAt).not.toBeNull();
  });

  it("a Meta failure sets status error with the code only; a later success recovers", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.once("getPhone", () => {
      throw metaError("190", 401);
    });
    expect(
      errorOf(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 })).message,
    ).toBe("META_190");
    expect(await row(kit)).toMatchObject({ status: "error", lastError: "META_190" });
    const dto = okValue(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 }));
    expect(dto.status).toBe("connected");
  });

  it("a version change or a disconnect during the fetch is CONNECTION_CHANGED with no write and no refresh-to-connected", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit);
    kit.whatsapp.set("getPhone", async () => {
      await kit.mem.connections.save(
        { ...conn, status: "disconnected", sealedCredentials: "" },
        conn.version,
      );
      return {
        phoneNumberId: "phone-1",
        displayPhoneNumber: "x",
        verifiedName: "y",
        qualityRating: "RED",
        messagingLimitTier: null,
      };
    });
    expect(
      errorOf(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 })).message,
    ).toBe("CONNECTION_CHANGED");
    expect(await row(kit)).toMatchObject({ status: "disconnected", qualityRating: "GREEN" });
    const kit2 = createOutreachKit();
    const conn2 = await seedConnection(kit2);
    kit2.whatsapp.set("getPhone", async () => {
      await kit2.mem.connections.save({ ...conn2, lastError: null }, conn2.version);
      throw metaError("190", 401);
    });
    expect(
      errorOf(await new RefreshWhatsAppStatus(kit2.deps).execute({ tenantId: T1 })).message,
    ).toBe("CONNECTION_CHANGED");
    expect((await row(kit2, T1)).status).toBe("connected");
  });

  it("needs ports and a live connection", async () => {
    expect.hasAssertions();
    expect(
      errorOf(
        await new RefreshWhatsAppStatus(createOutreachKit({ configured: false }).deps).execute({
          tenantId: T1,
        }),
      ).message,
    ).toBe("WHATSAPP_NOT_CONFIGURED");
    const kit = createOutreachKit();
    expect(
      errorOf(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 })).message,
    ).toBe("WHATSAPP_NOT_CONNECTED");
    await seedConnection(kit);
    kit.vault.failOpen = true;
    expect(
      errorOf(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 })).message,
    ).toBe("CREDENTIALS_UNAVAILABLE");
  });
});

describe("DisconnectWhatsApp and AbandonWhatsAppOnboarding", () => {
  it("disconnects: credentials cleared, directory row removed, event emitted", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit);
    const dto = okValue(
      await new DisconnectWhatsApp(kit.deps).execute({
        tenantId: T1,
        expectedVersion: conn.version,
      }),
    );
    expect(dto.status).toBe("disconnected");
    expect(await row(kit)).toMatchObject({ sealedCredentials: "", status: "disconnected" });
    expect((await row(kit)).disconnectedAt).not.toBeNull();
    expect(await kit.mem.directory.find("phone-1")).toBeNull();
    expect(kit.events.ofType("outreach.whatsapp.disconnected")[0]?.payload).toEqual({
      phoneNumberId: "phone-1",
      wabaId: "waba-1",
    });
  });

  it("is idempotent when already disconnected or never connected", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    expect(
      okValue(await new DisconnectWhatsApp(kit.deps).execute({ tenantId: T1, expectedVersion: 0 }))
        .status,
    ).toBe("not_connected");
    const conn = await seedConnection(kit);
    const uc = new DisconnectWhatsApp(kit.deps);
    okValue(await uc.execute({ tenantId: T1, expectedVersion: conn.version }));
    expect(okValue(await uc.execute({ tenantId: T1, expectedVersion: conn.version })).status).toBe(
      "disconnected",
    );
    expect(kit.events.ofType("outreach.whatsapp.disconnected")).toHaveLength(1);
  });

  it("a stale disconnect has no effect", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const conn = await seedConnection(kit);
    const error = errorOf(
      await new DisconnectWhatsApp(kit.deps).execute({
        tenantId: T1,
        expectedVersion: conn.version + 5,
      }),
    );
    expect(error).toBeInstanceOf(ConcurrencyError);
    expect((await row(kit)).status).toBe("connected");
    expect(await kit.mem.directory.find("phone-1")).not.toBeNull();
    expect(kit.events.calls).toHaveLength(0);
  });

  it("disconnecting an onboarding row clears it without a disconnected event", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const seeded = await seedConnection(kit, { status: "onboarding" });
    okValue(
      await new DisconnectWhatsApp(kit.deps).execute({
        tenantId: T1,
        expectedVersion: seeded.version,
      }),
    );
    expect(kit.events.calls).toHaveLength(0);
    expect((await row(kit)).status).toBe("disconnected");
  });

  it("Abandon only applies to onboarding; a stale version has no effect; idempotent when disconnected", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const abandon = new AbandonWhatsAppOnboarding(kit.deps);
    expect(okValue(await abandon.execute({ tenantId: T1, expectedVersion: 0 })).status).toBe(
      "not_connected",
    );
    const conn = await seedConnection(kit);
    expect(
      errorOf(await abandon.execute({ tenantId: T1, expectedVersion: conn.version })).message,
    ).toBe("ONBOARDING_NOT_ACTIVE");
    const kit2 = createOutreachKit();
    const seeded = await seedConnection(kit2, { status: "onboarding" });
    expect(
      errorOf(
        await new AbandonWhatsAppOnboarding(kit2.deps).execute({
          tenantId: T1,
          expectedVersion: seeded.version + 3,
        }),
      ),
    ).toBeInstanceOf(ConcurrencyError);
    expect((await row(kit2)).status).toBe("onboarding");
    okValue(
      await new AbandonWhatsAppOnboarding(kit2.deps).execute({
        tenantId: T1,
        expectedVersion: seeded.version,
      }),
    );
    expect(
      okValue(
        await new AbandonWhatsAppOnboarding(kit2.deps).execute({
          tenantId: T1,
          expectedVersion: 99,
        }),
      ).status,
    ).toBe("disconnected");
  });
});

/** Runs `after(row)` right after the FIRST in-transaction read of the connection row (a concurrent commit lands there). */
function afterFirstTransactionalRead(
  kit: OutreachKit,
  after: (r: WhatsAppConnectionRecord) => void,
): void {
  const real = kit.mem.connections;
  let fired = false;
  kit.deps.connections = new Proxy(real, {
    get(target, prop) {
      if (prop === "get") {
        return async (tenantId: string, tx?: unknown) => {
          const r = await target.get(tenantId, tx);
          if (tx !== undefined && !fired && r !== null) {
            fired = true;
            after(r);
          }
          return r;
        };
      }
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

describe("RefreshWhatsAppStatus — one checked row, CAS on the captured version (C1)", () => {
  const disconnectConcurrently = (kit: OutreachKit) =>
    afterFirstTransactionalRead(kit, (r) =>
      kit.mem.store.connections.set(
        T1,
        { ...r, status: "disconnected", sealedCredentials: "", version: r.version + 1 },
        undefined,
      ),
    );

  it("a disconnect landing between the validation and the save is CONNECTION_CHANGED with no write", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("getPhone", () => ({
      phoneNumberId: "phone-1",
      displayPhoneNumber: "+20 101 234 5678",
      verifiedName: "Shop",
      qualityRating: "RED",
      messagingLimitTier: "TIER_2K",
    }));
    disconnectConcurrently(kit);
    expect(
      errorOf(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 })).message,
    ).toBe("CONNECTION_CHANGED");
    expect(await row(kit)).toMatchObject({
      status: "disconnected",
      qualityRating: "GREEN",
      sealedCredentials: "",
    });
  });

  it("the Meta-failure branch is guarded the same way: no error status over a disconnected row", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.whatsapp.set("getPhone", () => {
      throw metaError("190", 401);
    });
    disconnectConcurrently(kit);
    expect(
      errorOf(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 })).message,
    ).toBe("CONNECTION_CHANGED");
    expect(await row(kit)).toMatchObject({ status: "disconnected", lastError: null });
  });

  it("a switch to other assets between the validation and the save is refused and keeps the new row", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    afterFirstTransactionalRead(kit, (r) =>
      kit.mem.store.connections.set(
        T1,
        { ...r, phoneNumberId: "phone-9", wabaId: "waba-9", version: r.version + 1 },
        undefined,
      ),
    );
    expect(
      errorOf(await new RefreshWhatsAppStatus(kit.deps).execute({ tenantId: T1 })).message,
    ).toBe("CONNECTION_CHANGED");
    expect(await row(kit)).toMatchObject({ phoneNumberId: "phone-9", qualityRating: "GREEN" });
  });
});

describe("ConnectWhatsApp — ownership is revalidated after every async gap (I3)", () => {
  it("an abandon during the exchange stops the owner before listPhoneNumberIds", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const gate = deferred<{ accessToken: string }>();
    kit.whatsapp.once("exchangeCode", () => gate.promise);
    const a = connect(kit);
    await flush();
    okValue(
      await new AbandonWhatsAppOnboarding(kit.deps).execute({
        tenantId: T1,
        expectedVersion: (await row(kit)).version,
      }),
    );
    gate.resolve({ accessToken: "late" });
    expect(errorOf(await a).message).toBe("CONNECTION_CHANGED");
    expect(kit.whatsapp.count("listPhoneNumberIds")).toBe(0);
    expect(kit.whatsapp.mutations).toBe(0);
    expect((await row(kit)).status).toBe("disconnected");
  });

  it("a takeover during the exchange stops the old owner before listPhoneNumberIds", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const gate = deferred<{ accessToken: string }>();
    kit.whatsapp.once("exchangeCode", () => gate.promise);
    const a = connect(kit);
    await flush();
    sleepPast(kit);
    okValue(await connect(kit, { code: "c" }));
    const before = kit.whatsapp.total;
    gate.resolve({ accessToken: "late" });
    expect(errorOf(await a).message).toBe("CONNECTION_CHANGED");
    expect(kit.whatsapp.total).toBe(before);
    expect(kit.whatsapp.count("registerPhone")).toBe(1);
  });

  it("a registered resume whose exchange failed re-checks ownership before getPhone", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("getPhone", () => {
      throw metaError("500", 500);
    });
    errorOf(await connect(kit));
    kit.whatsapp.once("exchangeCode", () => {
      throw metaError("100");
    });
    const gate = deferred<string[]>();
    kit.whatsapp.once("listPhoneNumberIds", () => gate.promise);
    const b = connect(kit, { code: "c2" });
    await flush();
    okValue(
      await new AbandonWhatsAppOnboarding(kit.deps).execute({
        tenantId: T1,
        expectedVersion: (await row(kit)).version,
      }),
    );
    gate.resolve(["phone-1"]);
    expect(errorOf(await b).message).toBe("CONNECTION_CHANGED");
    expect(kit.whatsapp.count("getPhone")).toBe(1);
  });

  it("a lease that expires between the finalize read and its write: the connection is not finalized and nothing is claimed", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const real = kit.mem.connections;
    kit.deps.connections = new Proxy(real, {
      get(target, prop) {
        if (prop === "writeAsLeaseOwner") {
          return (...args: Parameters<typeof real.writeAsLeaseOwner>) => {
            if (args[0].status === "connected") kit.clock.advance(ONBOARDING_LEASE_MS + 1);
            return target.writeAsLeaseOwner(...args);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    expect(errorOf(await connect(kit)).message).toBe("CONNECTION_CHANGED");
    expect(await row(kit)).toMatchObject({ status: "onboarding", onboardingStage: "registered" });
    expect(await kit.mem.directory.find("phone-1")).toBeNull();
    expect(kit.events.ofType("outreach.whatsapp.connected")).toHaveLength(0);
  });

  it("a failure recorded after the lease expired is not written (the failure write is lease-checked too)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.whatsapp.once("subscribeApp", () => {
      kit.clock.advance(ONBOARDING_LEASE_MS + 1);
      throw metaError("100");
    });
    expect(errorOf(await connect(kit)).message).toBe("CONNECTION_CHANGED");
    expect((await row(kit)).onboardingFailure).toBeNull();
  });
});

describe("ConnectWhatsApp — a persisted stage with unusable credentials fails closed (I8)", () => {
  const seedOnboarding = async (
    kit: OutreachKit,
    stage: WhatsAppConnectionRecord["onboardingStage"],
    sealed: string,
  ): Promise<void> => {
    await kit.mem.connections.save(
      {
        tenantId: T1,
        status: "onboarding",
        wabaId: "waba-1",
        phoneNumberId: "phone-1",
        displayPhoneNumber: null,
        verifiedName: null,
        qualityRating: null,
        messagingLimitTier: null,
        sealedCredentials: sealed,
        connectedAt: null,
        disconnectedAt: null,
        lastStatusSyncAt: null,
        lastError: null,
        onboardingAttemptId: "att-1",
        onboardingStage: stage,
        onboardingFailure: null,
        onboardingLeaseOwner: null,
        onboardingLeaseUntil: null,
        version: 1,
      },
      0,
    );
  };
  const stages = ["verified", "subscribed", "registering", "registered"] as const;

  it.each(stages)(
    "stage %s with an unreadable envelope: CREDENTIALS_UNAVAILABLE, no PIN drawn, no stage reset, no Meta call",
    async (stage) => {
      expect.hasAssertions();
      const kit = createOutreachKit();
      await seedOnboarding(kit, stage, "garbage-not-sealed");
      const pins = kit.pins.length;
      expect(errorOf(await connect(kit)).message).toBe("CREDENTIALS_UNAVAILABLE");
      expect(kit.pins).toHaveLength(pins);
      expect(kit.whatsapp.total).toBe(0);
      expect(kit.vault.sealCalls).toHaveLength(0);
      expect(await row(kit)).toMatchObject({
        onboardingStage: stage,
        sealedCredentials: "garbage-not-sealed",
        onboardingFailure: "CREDENTIALS_UNAVAILABLE",
        onboardingLeaseOwner: null,
      });
    },
  );

  it.each(stages)(
    "stage %s with a sealed envelope holding an invalid PIN: same refusal, nothing replaced",
    async (stage) => {
      expect.hasAssertions();
      const kit = createOutreachKit();
      const sealed = await kit.vault.seal(T1, "whatsapp", { accessToken: "tok", pin: "12" });
      kit.vault.sealCalls.length = 0;
      await seedOnboarding(kit, stage, sealed);
      const pins = kit.pins.length;
      expect(errorOf(await connect(kit)).message).toBe("CREDENTIALS_UNAVAILABLE");
      expect(kit.pins).toHaveLength(pins);
      expect(kit.whatsapp.total).toBe(0);
      expect(kit.vault.sealCalls).toHaveLength(0);
      expect(await row(kit)).toMatchObject({ onboardingStage: stage, sealedCredentials: sealed });
    },
  );

  it("only the stage-null placeholder (no credentials yet) may be sealed initially with a fresh PIN", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedOnboarding(kit, null, "");
    const dto = okValue(await connect(kit));
    expect(dto.status).toBe("connected");
    expect(registerPins(kit)).toEqual(["123456"]);
  });
});

describe("ConnectWhatsApp — switching assets clears the session windows (I4)", () => {
  const inbound = async (kit: OutreachKit, phone: string, waba: string, id: string) =>
    okValue(
      await new ProcessWhatsAppWebhook(kit.deps).execute({
        payload: messagesPayload(
          phone,
          {
            messages: [
              textMessage({
                id,
                from: "201012345678",
                timestamp: seconds(kit.clock.now()) - 60,
                body: "hello",
              }),
            ],
          },
          waba,
        ),
      }),
    );
  const reply = (kit: OutreachKit, key: string) =>
    new SendWhatsAppSessionMessage(kit.deps).execute({
      tenantId: T1,
      to: "01012345678",
      text: "hi",
      idempotencyKey: key,
    });

  it("inbound on A → switch to B → session refused until an inbound arrives on B", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, { phone: "+201012345678", transactional: "allowed" });
    await inbound(kit, "phone-1", "waba-1", "wamid.inA");
    expect(okValue(await reply(kit, "k-a")).status).toBe("accepted");

    kit.whatsapp.phoneIds = ["phone-2"];
    okValue(await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" }));
    expect(errorOf(await reply(kit, "k-b1")).message).toBe("SESSION_WINDOW_CLOSED");
    expect((await kit.mem.contacts.findByPhone(T1, "+201012345678"))?.lastInboundAt).toBeNull();

    await inbound(kit, "phone-2", "waba-2", "wamid.inB");
    expect(okValue(await reply(kit, "k-b2")).status).toBe("accepted");
  });

  it("clears the windows of every contact of the shop, and of no other shop", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const at = new Date(kit.clock.now().getTime() - 3_600_000);
    await seedContact(kit, { phone: "+201012345678", lastInboundAt: at });
    await seedContact(kit, { phone: "+201112345678", lastInboundAt: at });
    await seedContact(kit, { tenantId: T2, phone: "+201212345678", lastInboundAt: at });
    kit.whatsapp.phoneIds = ["phone-2"];
    okValue(await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" }));
    const windows = kit.mem.store.contacts
      .values()
      .map((c) => `${c.tenantId}:${c.lastInboundAt === null}`);
    expect(windows.sort()).toEqual([`${T1}:true`, `${T1}:true`, `${T2}:false`]);
  });

  it("a same-asset reconnect keeps the windows (the window is still that number's)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const at = new Date(kit.clock.now().getTime() - 3_600_000);
    await seedContact(kit, { phone: "+201012345678", lastInboundAt: at });
    okValue(await connect(kit));
    expect((await kit.mem.contacts.findByPhone(T1, "+201012345678"))?.lastInboundAt).toEqual(at);
  });

  it("a failed switch that is later resumed still ends with cleared windows", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const at = new Date(kit.clock.now().getTime() - 3_600_000);
    await seedContact(kit, { phone: "+201012345678", lastInboundAt: at });
    kit.whatsapp.phoneIds = ["phone-2"];
    kit.whatsapp.once("registerPhone", () => {
      throw metaError("100");
    });
    errorOf(await connect(kit, { wabaId: "waba-2", phoneNumberId: "phone-2" }));
    okValue(await connect(kit, { code: "c2", wabaId: "waba-2", phoneNumberId: "phone-2" }));
    expect((await kit.mem.contacts.findByPhone(T1, "+201012345678"))?.lastInboundAt).toBeNull();
  });
});
