import { UnexpectedError, type Logger } from "@platform/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GetLiveConnections,
  GetPublicAdPlatforms,
  ListConnections,
  OpenConnectionSecret,
  SaveConnection,
  type SaveConnectionInput,
} from "./application/connections.use-cases";
import type { CredentialPolicy, CredentialVaultPort, DeliverySyncPort } from "./application/ports";
import { AD_PLATFORMS } from "./domain/connection";
import { connectionsForDelivery, wireAdPlatforms } from "./composition";
import { InMemoryConnectionRepository } from "./infrastructure/in-memory-connection-repository";
import { InMemoryCredentialVault } from "./infrastructure/in-memory-credential-vault";
import { ConnectionsController } from "./interfaces/connections.controller";
import { present } from "./interfaces/presenter";

beforeEach(() => {
  expect.hasAssertions();
});

const NOW = new Date("2026-11-23T10:00:00.000Z");
const SECRET = "EAAB1234567890abcd";
const META = { platform: "meta", pixelId: "123456789012345" };
const SNAP_ID = "123e4567-e89b-12d3-a456-426614174000";
const clock = { now: () => NOW };

function counter(): { generate: () => string } {
  let n = 0;
  return {
    generate: () => {
      n += 1;
      return `id-${String(n)}`;
    },
  };
}

function harness(
  options: {
    vault?: CredentialVaultPort;
    policy?: CredentialPolicy;
    deliverySync?: DeliverySyncPort;
    logger?: Logger;
  } = {},
) {
  const repo = new InMemoryConnectionRepository();
  const vault = options.vault ?? new InMemoryCredentialVault();
  const save = new SaveConnection({
    connections: repo,
    vault,
    clock,
    idGenerator: counter(),
    credentialPolicy: options.policy ?? "allow_stub",
    deliverySync: options.deliverySync,
    logger: options.logger,
  });
  const controller = new ConnectionsController({
    listConnections: new ListConnections({ connections: repo }),
    saveConnection: save,
    getPublicAdPlatforms: new GetPublicAdPlatforms({ connections: repo }),
  });
  const live = new GetLiveConnections({ connections: repo, vault });
  const open = new OpenConnectionSecret({ connections: repo, vault });
  const input = (over: Partial<SaveConnectionInput> = {}): SaveConnectionInput => ({
    tenantId: "t-1",
    platform: "meta",
    enabled: true,
    publicConfig: META,
    secret: SECRET,
    expectedVersion: 0,
    ...over,
  });
  return { repo, vault, save, controller, live, open, input };
}

describe("list", () => {
  it("returns five unconfigured views in platform order for an empty shop", async () => {
    const { controller } = harness();
    const response = await controller.list({ tenantId: "t-1" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      AD_PLATFORMS.map((platform) => ({
        platform,
        enabled: false,
        publicConfig: null,
        secret: { configured: false, last4: null },
        testEventCode: null,
        complete: false,
        live: false,
        version: 0,
      })),
    );
  });
});

describe("save", () => {
  it("answers CONCURRENCY when the repository loses the optimistic write", async () => {
    const h = harness();
    vi.spyOn(h.repo, "save").mockResolvedValueOnce(false);
    const result = await h.save.execute(h.input());
    expect(result.ok === false && result.error.code).toBe("CONCURRENCY");
  });
});

describe("credential policy", () => {
  it("refuses a secret on a stub vault under require_real_vault with 503 and stores nothing", async () => {
    const h = harness({ policy: "require_real_vault" });
    const response = await h.controller.save(h.input());
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: "UNAVAILABLE",
      message: "ad platform credential storage is not configured",
      retryable: false,
      fields: [],
      traceId: undefined,
    });
    expect(await h.repo.list("t-1")).toEqual([]);
  });

  it("still saves without a secret under require_real_vault", async () => {
    const h = harness({ policy: "require_real_vault" });
    const response = await h.controller.save(h.input({ secret: undefined }));
    expect(response.status).toBe(200);
  });

  it("accepts a secret when the vault is real", async () => {
    const real: CredentialVaultPort = {
      backing: "real",
      seal: (_t, _p, secret) => Promise.resolve(`sealed:${String(secret.length)}`),
      open: () => Promise.resolve(SECRET),
    };
    const h = harness({ policy: "require_real_vault", vault: real });
    const response = await h.controller.save(h.input());
    expect(response.status).toBe(200);
  });
});

describe("public view", () => {
  it("shows enabled public ids without needing a secret and hides disabled ones", async () => {
    const h = harness();
    await h.save.execute(h.input({ secret: undefined }));
    await h.save.execute(
      h.input({
        platform: "google_ads",
        publicConfig: { conversionId: "AW-123456789", labels: { purchase: "p1" } },
        secret: undefined,
      }),
    );
    await h.save.execute(
      h.input({ platform: "ga4", publicConfig: { measurementId: "G-ABC1234" }, enabled: false }),
    );
    await h.save.execute(
      h.input({ platform: "tiktok", publicConfig: { pixelCode: "CABCDEFGHIJ1" } }),
    );
    await h.save.execute(h.input({ platform: "snap", publicConfig: { pixelId: SNAP_ID } }));
    const response = await h.controller.publicView({ tenantId: "t-1" });
    expect(response).toEqual({
      status: 200,
      body: {
        meta: { pixelId: "123456789012345" },
        tiktok: { pixelCode: "CABCDEFGHIJ1" },
        snap: { pixelId: SNAP_ID },
        ga4: null,
        googleAds: { conversionId: "AW-123456789", labels: { purchase: "p1" } },
      },
    });
  });

  it("is all null for an empty shop", async () => {
    const h = harness();
    expect(await h.controller.publicView({ tenantId: "t-9" })).toEqual({
      status: 200,
      body: { meta: null, tiktok: null, snap: null, ga4: null, googleAds: null },
    });
  });
});

describe("stub vault and in-memory repository", () => {
  it("makes the stub vault refuse a copied envelope for another shop, another platform or garbage", async () => {
    const vault = new InMemoryCredentialVault();
    const sealed = await vault.seal("t-1", "meta", SECRET);
    expect(sealed).not.toContain(SECRET);
    await expect(vault.open("t-1", "meta", sealed)).resolves.toBe(SECRET);
    const refused = "Ad platform credentials could not be opened";
    await expect(vault.open("t-2", "meta", sealed)).rejects.toThrow(refused);
    await expect(vault.open("t-1", "tiktok", sealed)).rejects.toThrow(refused);
    await expect(vault.open("t-1", "meta", "%%%not-base64-json")).rejects.toThrow(refused);
    await expect(vault.open("t-1", "meta", Buffer.from("{}").toString("base64"))).rejects.toThrow(
      refused,
    );
    expect(vault.backing).toBe("stub");
  });

  it("makes the repository honour the expected version", async () => {
    const h = harness();
    await h.save.execute(h.input());
    const stored = await h.repo.get("t-1", "meta");
    expect(stored).not.toBeNull();
    if (stored !== null) {
      const fresh = new InMemoryConnectionRepository();
      expect(await fresh.save("t-1", stored, 1)).toBe(false); // nothing stored yet
      expect(await fresh.save("t-1", stored, null)).toBe(true);
      expect(await fresh.save("t-1", stored, null)).toBe(false); // already exists
      expect(await fresh.save("t-1", stored, 7)).toBe(false); // wrong version
      expect(await fresh.save("t-1", stored, 1)).toBe(true);
      expect(await fresh.get("t-2", "meta")).toBeNull();
    }
  });
});

describe("wireAdPlatforms and the controller", () => {
  const wire = (deps: Partial<Parameters<typeof wireAdPlatforms>[0]> = {}) =>
    wireAdPlatforms({ clock, idGenerator: counter(), ...deps });

  it("lists five unconfigured platforms for an empty shop", async () => {
    const response = await wire().controller.list({ tenantId: "t-1" });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(5);
  });

  it("returns 200 with the view and never leaks the secret or the sealed envelope", async () => {
    const service = wire();
    const response = await service.controller.save({
      tenantId: "t-1",
      platform: "meta",
      enabled: true,
      publicConfig: META,
      secret: SECRET,
      expectedVersion: 0,
    });
    expect(response.status).toBe(200);
    const sealed = Buffer.from(JSON.stringify({ t: "t-1", p: "meta", s: SECRET })).toString(
      "base64",
    );
    const json = JSON.stringify(response.body);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("sealedSecret");
    expect(json).not.toContain(sealed);
    const listed = JSON.stringify((await service.controller.list({ tenantId: "t-1" })).body);
    expect(listed).not.toContain(SECRET);
    expect(listed).not.toContain("sealedSecret");
    expect(listed).not.toContain(sealed);
    expect(await service.drainOutbox()).toBe(0);
    expect(service.deliveredEventTypes).toEqual([]);
  });

  it("maps validation, concurrency and policy errors to 422, 409 and 503", async () => {
    const service = wire({ credentialPolicy: "require_real_vault" });
    const base = {
      tenantId: "t-1",
      platform: "meta" as const,
      enabled: true,
      publicConfig: META,
      expectedVersion: 0,
    };
    expect((await service.controller.save({ ...base, secret: "x" })).status).toBe(422);
    expect((await service.controller.save({ ...base, secret: SECRET })).status).toBe(503);
    expect((await service.controller.save({ ...base })).status).toBe(200);
    expect((await service.controller.save({ ...base })).status).toBe(409);
  });

  it("falls back to status 422 for an unmapped error code", () => {
    expect(present({ ok: false, error: new UnexpectedError() }, 200).status).toBe(422);
  });

  it("serves the public view through the controller", async () => {
    const service = wire();
    await service.controller.save({
      tenantId: "t-1",
      platform: "meta",
      enabled: true,
      publicConfig: META,
      expectedVersion: 0,
    });
    expect((await service.controller.publicView({ tenantId: "t-1" })).body).toMatchObject({
      meta: { pixelId: "123456789012345" },
    });
  });
});

describe("connectionsForDelivery", () => {
  it("lists live connections and opens a live secret", async () => {
    const service = wireAdPlatforms({ clock, idGenerator: counter() });
    await service.controller.save({
      tenantId: "t-1",
      platform: "meta",
      enabled: true,
      publicConfig: META,
      secret: SECRET,
      expectedVersion: 0,
    });
    const delivery = connectionsForDelivery(service.internal);
    expect(await delivery.listLive("t-1")).toEqual([
      { platform: "meta", publicConfig: META, secret: SECRET, testEventCode: null },
    ]);
    expect(await delivery.openSecret("t-1", "meta")).toBe(SECRET);
  });

  it("answers null for a connection that is not live (NOT_FOUND)", async () => {
    const service = wireAdPlatforms({ clock, idGenerator: counter() });
    const delivery = connectionsForDelivery(service.internal);
    expect(await delivery.openSecret("t-1", "meta")).toBeNull();
    expect(await delivery.listLive("t-1")).toEqual([]);
  });

  it("throws one generic error on any other failure, without secret details", async () => {
    const broken: CredentialVaultPort = {
      backing: "real",
      seal: () => Promise.resolve("sealed"),
      open: () => Promise.reject(new Error(`boom ${SECRET}`)),
    };
    const service = wireAdPlatforms({ clock, idGenerator: counter(), vault: broken });
    await service.controller.save({
      tenantId: "t-1",
      platform: "meta",
      enabled: true,
      publicConfig: META,
      secret: SECRET,
      expectedVersion: 0,
    });
    const delivery = connectionsForDelivery(service.internal);
    await expect(delivery.listLive("t-1")).rejects.toThrow("ad platform connections unavailable");
    await expect(delivery.openSecret("t-1", "meta")).rejects.toThrow(
      "ad platform connections unavailable",
    );
  });
});

describe("dependency failures never escape", () => {
  const LEAK = "TOKEN-LEAK-9f3c";
  const leaky = (label: string): Error =>
    new Error(`${label} ${LEAK}`, { cause: new Error(`nested ${LEAK}`, { cause: LEAK }) });
  const unexpectedStatus = present({ ok: false, error: new UnexpectedError() }, 200).status;

  function spyLogger() {
    const fns = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { logger: fns as unknown as Logger, fns };
  }
  const noLeakIn = (value: unknown): void => {
    expect(JSON.stringify(value)).not.toContain("TOKEN-LEAK");
    expect(String(value)).not.toContain("TOKEN-LEAK");
  };
  const expectFixed = (result: { ok: boolean }, message: string): void => {
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const { error } = result as unknown as { error: Error & { code: string } };
      expect(error.code).toBe("UNEXPECTED");
      expect(error.message).toBe(message);
      expect(error.cause).toBeUndefined();
      noLeakIn(error);
    }
  };
  const allLogged = (fns: Record<string, ReturnType<typeof vi.fn>>): string =>
    JSON.stringify(Object.values(fns).map((fn) => fn.mock.calls));

  it("turns a rejected vault.seal into a generic response with no write and no sync", async () => {
    const { logger, fns } = spyLogger();
    const sync = vi.fn<(tenantId: string) => Promise<void>>().mockResolvedValue(undefined);
    const vault: CredentialVaultPort = {
      backing: "real",
      seal: () => Promise.reject(leaky("seal")),
      open: () => Promise.resolve(SECRET),
    };
    const h = harness({ vault, logger, deliverySync: { sync } });
    const response = await h.controller.save(h.input());
    expect(response.status).toBe(unexpectedStatus);
    expect(JSON.stringify(response)).not.toContain("TOKEN-LEAK");
    expect(JSON.stringify(response)).toContain("Ad platform credentials could not be sealed");
    expect(await h.repo.list("t-1")).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
    expect(allLogged(fns)).not.toContain("TOKEN-LEAK");
  });

  it("turns a rejected repository.get into a fixed cause-free error on save and open", async () => {
    const { logger, fns } = spyLogger();
    const h = harness({ logger });
    vi.spyOn(h.repo, "get").mockRejectedValue(leaky("get"));
    expectFixed(await h.save.execute(h.input()), "Ad platform connections could not be loaded");
    expectFixed(
      await h.open.execute({ tenantId: "t-1", platform: "meta" }),
      "Ad platform connections could not be loaded",
    );
    expect(allLogged(fns)).not.toContain("TOKEN-LEAK");
  });

  it("turns a rejected repository.list into a fixed error everywhere it is read", async () => {
    const { logger, fns } = spyLogger();
    const h = harness({ logger });
    vi.spyOn(h.repo, "list").mockRejectedValue(leaky("list"));
    const message = "Ad platform connections could not be loaded";
    expectFixed(
      await new ListConnections({ connections: h.repo }).execute({ tenantId: "t-1" }),
      message,
    );
    expectFixed(
      await new GetPublicAdPlatforms({ connections: h.repo }).execute({ tenantId: "t-1" }),
      message,
    );
    expectFixed(await h.live.execute({ tenantId: "t-1" }), message);
    for (const response of [
      await h.controller.list({ tenantId: "t-1" }),
      await h.controller.publicView({ tenantId: "t-1" }),
    ]) {
      expect(response.status).toBe(unexpectedStatus);
      noLeakIn(response);
    }
    expect(allLogged(fns)).not.toContain("TOKEN-LEAK");
  });

  it("makes the delivery adapter reject with one generic message and no cause", async () => {
    const h = harness();
    await h.save.execute(h.input());
    vi.spyOn(h.repo, "list").mockRejectedValue(leaky("list"));
    vi.spyOn(h.repo, "get").mockRejectedValue(leaky("get"));
    const delivery = connectionsForDelivery({ getLiveConnections: h.live, openSecret: h.open });
    for (const call of [() => delivery.listLive("t-1"), () => delivery.openSecret("t-1", "meta")]) {
      const error: unknown = await call().then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(Error);
      const caught = error as Error;
      expect(caught.message).toBe("ad platform connections unavailable");
      expect(caught.cause).toBeUndefined();
      expect(caught.message).not.toContain("TOKEN-LEAK");
      expect(caught.stack ?? "").not.toContain("TOKEN-LEAK");
    }
  });

  it("makes the delivery adapter generic even if a use case itself rejects", async () => {
    const rejecting = {
      getLiveConnections: { execute: () => Promise.reject(leaky("live")) },
      openSecret: { execute: () => Promise.reject(leaky("open")) },
    } as unknown as Parameters<typeof connectionsForDelivery>[0];
    const delivery = connectionsForDelivery(rejecting);
    for (const call of [() => delivery.listLive("t-1"), () => delivery.openSecret("t-1", "meta")]) {
      const error: unknown = await call().then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      expect((error as Error).message).toBe("ad platform connections unavailable");
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it("makes the controller answer a generic error when a use case rejects", async () => {
    const reject = { execute: () => Promise.reject(leaky("use case")) };
    const controller = new ConnectionsController({
      listConnections: reject as unknown as ListConnections,
      saveConnection: reject as unknown as SaveConnection,
      getPublicAdPlatforms: reject as unknown as GetPublicAdPlatforms,
    });
    for (const response of [
      await controller.list({ tenantId: "t-1" }),
      await controller.save({
        tenantId: "t-1",
        platform: "meta",
        enabled: true,
        publicConfig: META,
        expectedVersion: 0,
      }),
      await controller.publicView({ tenantId: "t-1" }),
    ]) {
      expect(response.status).toBe(unexpectedStatus);
      expect(response.body).toMatchObject({
        code: "UNEXPECTED",
        message: "An unexpected error occurred",
      });
      noLeakIn(response);
    }
  });

  it("turns a rejected repository.save after a seal into a fixed error and skips sync", async () => {
    const { logger, fns } = spyLogger();
    const sync = vi.fn<(tenantId: string) => Promise<void>>().mockResolvedValue(undefined);
    const h = harness({ logger, deliverySync: { sync } });
    vi.spyOn(h.repo, "save").mockRejectedValue(leaky("save"));
    const result = await h.save.execute(h.input());
    expectFixed(result, "Ad platform connections could not be saved");
    expect(sync).not.toHaveBeenCalled();
    expect(allLogged(fns)).not.toContain("TOKEN-LEAK");
  });

  it("survives a logger that throws while reporting a sync failure", async () => {
    const logger = {
      warn: () => {
        throw leaky("logger");
      },
    } as unknown as Logger;
    const sync = vi.fn<(tenantId: string) => Promise<void>>().mockRejectedValue(leaky("sync"));
    const h = harness({ logger, deliverySync: { sync } });
    const result = await h.save.execute(h.input());
    expect(result.ok).toBe(true);
  });
});
