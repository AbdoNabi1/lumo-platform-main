import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { wireAdmin, type WiredAdmin } from "../composition";
import { publicAuthRoutes } from "./public-auth-routes";

const clock: Clock = { now: () => new Date("2026-10-06T00:00:00.000Z") };

function build(store: InMemoryPasswordCredentialStore): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store,
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
  });
}

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function call(admin: WiredAdmin, path: string, tenantId: string, body: unknown): Promise<Response> {
  const route = publicAuthRoutes(admin).find((r) => r.method === "POST" && r.path === path);
  if (route === undefined) throw new Error(`no route POST ${path}`);
  return route.handle({
    body,
    params: {},
    query: {},
    context: { tenantId, requestId: "req-1", headers: {} },
  } as never) as Promise<Response>;
}

describe("customer passwords are durable and tenant-scoped (Plan 1B-1)", () => {
  it("a registered customer can log in, and the stored credential is a hash in the shared store", async () => {
    const store = new InMemoryPasswordCredentialStore();
    const admin = build(store);
    const registered = await call(admin, "/public/auth/register", "shop-a", {
      email: "Sara@Example.com",
      name: "Sara",
      password: "fake-password-1",
    });
    expect(registered.status).toBe(201);
    const login = await call(admin, "/public/auth/login", "shop-a", {
      email: "sara@example.com",
      password: "fake-password-1",
    });
    expect(login.status).toBe(200);
    const record = await store.find("shop-a", "sara@example.com");
    expect(record?.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("the same email registered in another shop does not log in to the first", async () => {
    const store = new InMemoryPasswordCredentialStore();
    const admin = build(store);
    await call(admin, "/public/auth/register", "shop-a", {
      email: "x@y.com",
      name: "A",
      password: "fake-password-a",
    });
    await call(admin, "/public/auth/register", "shop-b", {
      email: "x@y.com",
      name: "B",
      password: "fake-password-b",
    });
    const wrongShop = await call(admin, "/public/auth/login", "shop-a", {
      email: "x@y.com",
      password: "fake-password-b",
    });
    expect(wrongShop.status).toBe(401);
    const rightShop = await call(admin, "/public/auth/login", "shop-b", {
      email: "x@y.com",
      password: "fake-password-b",
    });
    expect(rightShop.status).toBe(200);
  });
});
