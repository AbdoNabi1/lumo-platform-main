import { describe, expect, it } from "vitest";
import type { InMemoryEmailConnectionRepository } from "../infrastructure/in-memory-messaging-repositories";
import { STORE_KEY, storeEmailFixture } from "../testing/store-email-fixture";
import { StoreEmailDelivery, StoreEmailError } from "./store-email-delivery";

const TENANT = "tenant-a";
const OTHER = "tenant-b";
const mail = {
  to: "sara@customer.test",
  subject: "Order #1 confirmed",
  text: "Thanks",
  html: "<p>Thanks</p>",
  idempotencyKey: "n-1:attempt:0",
};

async function failure(promise: Promise<unknown>): Promise<StoreEmailError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(StoreEmailError);
  return error as StoreEmailError;
}

describe("StoreEmailDelivery matrix (D46): none / disabled / failed / connected / refusing", () => {
  it("connected: sends through the store's own key, From the store name at the merchant address", async () => {
    expect.hasAssertions();
    const { delivery, provider, connect } = storeEmailFixture();
    await connect(TENANT, { fromEmail: "Shop@Nusuj.com" });
    await delivery.send(TENANT, "Nusuj Store", mail);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.credentials).toEqual({ kind: "resend", apiKey: STORE_KEY });
    expect(provider.calls[0]?.message).toMatchObject({
      to: "sara@customer.test",
      from: '"Nusuj Store" <shop@nusuj.com>',
      idempotencyKey: "n-1:attempt:0",
    });
    expect(await delivery.isConnected(TENANT)).toBe(true);
  });

  it("no connection: EMAIL_NOT_CONNECTED and the provider is never called", async () => {
    expect.hasAssertions();
    const { delivery, provider } = storeEmailFixture();
    const error = await failure(delivery.send(TENANT, "S", mail));
    expect(error.code).toBe("EMAIL_NOT_CONNECTED");
    expect(error.message).toBe("EMAIL_NOT_CONNECTED");
    expect(provider.calls).toHaveLength(0);
    expect(await delivery.isConnected(TENANT)).toBe(false);
  });

  it("switched off: EMAIL_NOT_CONNECTED, never sent", async () => {
    expect.hasAssertions();
    const { delivery, provider, connect } = storeEmailFixture();
    await connect(TENANT, { enabled: false });
    expect((await failure(delivery.send(TENANT, "S", mail))).code).toBe("EMAIL_NOT_CONNECTED");
    expect(provider.calls).toHaveLength(0);
    expect(await delivery.isConnected(TENANT)).toBe(false);
  });

  it("last test failed: EMAIL_NOT_CONNECTED, never sent", async () => {
    expect.hasAssertions();
    const { delivery, provider, connect } = storeEmailFixture();
    await connect(TENANT, { status: "failed" });
    expect((await failure(delivery.send(TENANT, "S", mail))).code).toBe("EMAIL_NOT_CONNECTED");
    expect(provider.calls).toHaveLength(0);
  });

  it("another store's connection is never borrowed", async () => {
    expect.hasAssertions();
    const { delivery, provider, connect } = storeEmailFixture();
    await connect(OTHER);
    expect((await failure(delivery.send(TENANT, "S", mail))).code).toBe("EMAIL_NOT_CONNECTED");
    expect(provider.calls).toHaveLength(0);
  });

  it("a sealed key that no longer opens: EMAIL_NOT_CONNECTED, noted on the connection, nothing sent", async () => {
    expect.hasAssertions();
    const { connections, provider, connect, delivery } = storeEmailFixture();
    await connect(TENANT);
    // The same row opened by a delivery whose vault holds another KEK.
    const { vault: wrongVault } = storeEmailFixture();
    const other = new StoreEmailDelivery({
      connections,
      vault: {
        ...wrongVault,
        backing: "real",
        seal: wrongVault.seal.bind(wrongVault),
        open: () => Promise.reject(new Error("x")),
      },
      provider,
      clock: { now: () => new Date("2026-11-26T11:00:00.000Z") },
    });
    expect((await failure(other.send(TENANT, "S", mail))).code).toBe("EMAIL_NOT_CONNECTED");
    expect(provider.calls).toHaveLength(0);
    expect(connections.peek(TENANT)?.lastError).toMatch(/can't be used any more/);
    expect(await delivery.isConnected(TENANT)).toBe(true);
  });

  it("no vault or no provider configured: nothing is sent", async () => {
    expect.hasAssertions();
    const { connections, provider, vault, connect } = storeEmailFixture();
    await connect(TENANT);
    const clock = { now: () => new Date() };
    const noVault = new StoreEmailDelivery({ connections, provider, clock });
    const noProvider = new StoreEmailDelivery({ connections, vault, clock });
    expect((await failure(noVault.send(TENANT, "S", mail))).code).toBe("EMAIL_NOT_CONNECTED");
    expect((await failure(noProvider.send(TENANT, "S", mail))).code).toBe("EMAIL_NOT_CONNECTED");
    expect(await noVault.isConnected(TENANT)).toBe(false);
    expect(await noProvider.isConnected(TENANT)).toBe(false);
    expect(provider.calls).toHaveLength(0);
  });

  it("a provider that refuses: its code, a sanitized last_error on the connection, no key or address kept", async () => {
    expect.hasAssertions();
    const { delivery, provider, connect, connections } = storeEmailFixture();
    await connect(TENANT);
    provider.failNext(
      "EMAIL_SENDER_REJECTED",
      `The nusuj.com domain is not verified. to=sara@customer.test key=${STORE_KEY}`,
    );
    const error = await failure(delivery.send(TENANT, "S", mail));
    expect(error.code).toBe("EMAIL_SENDER_REJECTED");
    expect(error.message).toBe("EMAIL_SENDER_REJECTED");
    const row = connections.peek(TENANT);
    expect(row?.lastError).toContain("domain is not verified");
    expect(row?.lastError).not.toContain("sara@customer.test");
    expect(row?.lastError).not.toContain(STORE_KEY);
    expect(row?.lastErrorAt).toEqual(new Date("2026-11-26T10:00:00.000Z"));
    // A refused mail does not switch the connection off: the next mail is tried again.
    expect(row?.status).toBe("connected");
    await delivery.send(TENANT, "S", { ...mail, idempotencyKey: "n-2:attempt:0" });
    expect(provider.calls).toHaveLength(2);
  });

  it("a provider that THROWS becomes EMAIL_PROVIDER_UNAVAILABLE; what it threw (a key) is not kept", async () => {
    expect.hasAssertions();
    const { delivery, provider, connect, connections } = storeEmailFixture();
    await connect(TENANT);
    provider.throwNext();
    const error = await failure(delivery.send(TENANT, "S", mail));
    expect(error.code).toBe("EMAIL_PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(error)).not.toContain(STORE_KEY);
    expect(String(error.cause ?? "")).not.toContain(STORE_KEY);
    expect(JSON.stringify(connections.peek(TENANT))).not.toContain("boom");
  });

  it("the SAME idempotency key reaches the provider on a retry of the same mail", async () => {
    expect.hasAssertions();
    const { delivery, provider, connect } = storeEmailFixture();
    await connect(TENANT);
    provider.failNext("EMAIL_PROVIDER_UNAVAILABLE", "try later");
    await failure(delivery.send(TENANT, "S", mail));
    await delivery.send(TENANT, "S", mail);
    expect(provider.idempotencyKeys()).toEqual(["n-1:attempt:0", "n-1:attempt:0"]);
  });

  it("a mail without a key (a sign-up mail, a test) is sent without one", async () => {
    expect.hasAssertions();
    const { delivery, provider, connect } = storeEmailFixture();
    await connect(TENANT);
    const { idempotencyKey: _ignored, ...bare } = mail;
    await delivery.send(TENANT, "S", bare);
    expect("idempotencyKey" in (provider.calls[0]?.message ?? {})).toBe(false);
  });

  it("a failure to record the failure never hides the failure", async () => {
    expect.hasAssertions();
    const { provider, vault, connect, connections } = storeEmailFixture();
    await connect(TENANT);
    const broken = Object.assign(Object.create(connections) as InMemoryEmailConnectionRepository, {
      recordFailure: () => Promise.reject(new Error("db down")),
    });
    const delivery = new StoreEmailDelivery({
      connections: broken,
      vault,
      provider,
      clock: { now: () => new Date() },
    });
    provider.failNext("EMAIL_RATE_LIMITED", "slow down");
    expect((await failure(delivery.send(TENANT, "S", mail))).code).toBe("EMAIL_RATE_LIMITED");
  });
});
