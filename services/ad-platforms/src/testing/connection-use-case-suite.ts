import type { ValidationError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import {
  GetLiveConnections,
  GetPublicAdPlatforms,
  ListConnections,
  OpenConnectionSecret,
  SaveConnection,
  type SaveConnectionInput,
} from "../application/connections.use-cases";
import { AD_PLATFORMS } from "../domain/connection";
import type { ConnectionRepository } from "../domain/connection-repository";
import { InMemoryCredentialVault } from "../infrastructure/in-memory-credential-vault";

const NOW = new Date("2026-11-23T10:00:00.000Z");
const SECRET = "EAAB1234567890abcd";
const SNAP_ID = "123e4567-e89b-12d3-a456-426614174000";
const META = { platform: "meta", pixelId: "123456789012345" };
const clock = { now: () => NOW };

/**
 * The connections use-case suite, parametrised over the repository: the in-memory unit run and the
 * `DATABASE_URL_TEST`-gated Prisma run (`prisma-connection-repository.integration.test.ts`) execute the
 * same cases, so the two repositories are proven to behave the same (round trip, version guard, one row per
 * shop and platform, tenant isolation). Call it inside a `describe`; the caller owns
 * `beforeEach(expect.hasAssertions)` and cleanup. Rows use real UUIDs (the `id` column is a uuid).
 */
export function describeConnectionUseCases(makeRepo: () => ConnectionRepository): void {
  function setup() {
    const connections = makeRepo();
    const vault = new InMemoryCredentialVault();
    return {
      connections,
      vault,
      list: new ListConnections({ connections }),
      save: new SaveConnection({
        connections,
        vault,
        clock,
        idGenerator: { generate: () => crypto.randomUUID() },
        credentialPolicy: "allow_stub",
      }),
      live: new GetLiveConnections({ connections, vault }),
      open: new OpenConnectionSecret({ connections, vault }),
      publicView: new GetPublicAdPlatforms({ connections }),
    };
  }

  const input = (over: Partial<SaveConnectionInput> = {}): SaveConnectionInput => ({
    tenantId: "t-1",
    platform: "meta",
    enabled: true,
    publicConfig: META,
    secret: SECRET,
    expectedVersion: 0,
    ...over,
  });

  function value<T>(result: { ok: boolean; value?: T }): T {
    if (!result.ok || result.value === undefined) throw new Error("expected ok");
    return result.value;
  }

  describe("ListConnections", () => {
    it("lists five unconfigured views in platform order for an empty shop", async () => {
      const s = setup();
      const views = value(await s.list.execute({ tenantId: "t-1" }));
      expect(views.map((v) => v.platform)).toEqual([...AD_PLATFORMS]);
      expect(views.every((v) => !v.enabled && !v.secret.configured && v.version === 0)).toBe(true);
    });
  });

  describe("SaveConnection", () => {
    it("saves a live connection, seals the secret and reads it back", async () => {
      const s = setup();
      const saved = value(await s.save.execute(input()));
      expect(saved).toEqual({
        platform: "meta",
        enabled: true,
        publicConfig: META,
        secret: { configured: true, last4: "abcd" },
        testEventCode: null,
        complete: true,
        live: true,
        version: 1,
      });
      const stored = await s.connections.get("t-1", "meta");
      expect(stored?.props.sealedSecret).not.toBeNull();
      expect(stored?.props.sealedSecret).not.toContain(SECRET);
      expect(stored?.props.createdAt).toEqual(NOW);
      const listed = value(await s.list.execute({ tenantId: "t-1" }));
      expect(listed.find((v) => v.platform === "meta")).toEqual(saved);
    });

    it("keeps the stored secret when the next save sends none, and bumps the version", async () => {
      const s = setup();
      value(await s.save.execute(input()));
      const second = value(
        await s.save.execute(input({ secret: "", enabled: false, expectedVersion: 1 })),
      );
      expect(second.secret).toEqual({ configured: true, last4: "abcd" });
      expect(second.live).toBe(false);
      expect(second.version).toBe(2);
    });

    it("replaces the secret and the test event code, and removes the secret on clearSecret", async () => {
      const s = setup();
      value(await s.save.execute(input({ testEventCode: "TEST1" })));
      const replaced = value(
        await s.save.execute(input({ secret: "NEWTOKEN-0987654321", expectedVersion: 1 })),
      );
      expect(replaced.secret.last4).toBe("4321");
      expect(replaced.testEventCode).toBe("TEST1");
      const cleared = value(
        await s.save.execute(input({ secret: "", clearSecret: true, expectedVersion: 2 })),
      );
      expect(cleared.secret).toEqual({ configured: false, last4: null });
      expect(cleared.complete).toBe(false);
      expect((await s.connections.get("t-1", "meta"))?.props.sealedSecret).toBeNull();
    });

    it("stores a disabled connection with no public config", async () => {
      const s = setup();
      const saved = value(
        await s.save.execute(input({ enabled: false, publicConfig: null, secret: "" })),
      );
      expect(saved.publicConfig).toBeNull();
      expect(saved.complete).toBe(false);
      expect((await s.connections.get("t-1", "meta"))?.props.publicConfig).toBeNull();
    });

    it("stores google_ads (public config only) and refuses a secret for it", async () => {
      const s = setup();
      const saved = value(
        await s.save.execute(
          input({
            platform: "google_ads",
            publicConfig: { conversionId: "AW-123456789", labels: { lead: "abc" } },
            secret: "",
          }),
        ),
      );
      expect(saved.complete).toBe(true);
      expect(saved.live).toBe(true);
      const refused = await s.save.execute(
        input({
          platform: "google_ads",
          publicConfig: null,
          enabled: false,
          secret: SECRET,
          expectedVersion: 1,
        }),
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe("VALIDATION");
        expect((refused.error as ValidationError).fields.map((f) => f.field)).toEqual(["secret"]);
      }
    });

    it("answers CONCURRENCY for a stale expected version and for a second first save", async () => {
      const s = setup();
      value(await s.save.execute(input()));
      const second = await s.save.execute(input());
      expect(second.ok === false && second.error.code).toBe("CONCURRENCY");
      const stale = await s.save.execute(input({ secret: "", expectedVersion: 7 }));
      expect(stale.ok === false && stale.error.code).toBe("CONCURRENCY");
      expect((await s.connections.get("t-1", "meta"))?.props.version).toBe(1);
    });

    it("keeps one row per shop and platform: two racing first saves, one wins", async () => {
      const s = setup();
      const results = await Promise.all([s.save.execute(input()), s.save.execute(input())]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const lost = results.find((r) => !r.ok);
      expect(lost?.ok === false && lost.error.code).toBe("CONCURRENCY");
      expect(await s.connections.list("t-1")).toHaveLength(1);
    });
  });

  describe("GetLiveConnections / OpenConnectionSecret / GetPublicAdPlatforms", () => {
    it("opens the secret of live server platforms only", async () => {
      const s = setup();
      value(await s.save.execute(input()));
      value(
        await s.save.execute(
          input({
            platform: "snap",
            publicConfig: { pixelId: SNAP_ID },
            secret: "SNAPTOKEN-1234567890",
            enabled: false,
          }),
        ),
      );
      const live = value(await s.live.execute({ tenantId: "t-1" }));
      expect(live).toEqual([
        { platform: "meta", publicConfig: META, secret: SECRET, testEventCode: null },
      ]);
      expect(value(await s.open.execute({ tenantId: "t-1", platform: "meta" }))).toBe(SECRET);
      const disabled = await s.open.execute({ tenantId: "t-1", platform: "snap" });
      expect(disabled.ok === false && disabled.error.code).toBe("NOT_FOUND");
    });

    it("publishes only the public ids of enabled platforms", async () => {
      const s = setup();
      value(await s.save.execute(input({ secret: "" })));
      value(
        await s.save.execute(
          input({
            platform: "google_ads",
            publicConfig: { conversionId: "AW-123456789", labels: { contact: "c1" } },
            secret: "",
          }),
        ),
      );
      value(
        await s.save.execute(
          input({
            platform: "ga4",
            publicConfig: { measurementId: "G-ABCD1234" },
            enabled: false,
            secret: "",
          }),
        ),
      );
      expect(value(await s.publicView.execute({ tenantId: "t-1" }))).toEqual({
        meta: { pixelId: "123456789012345" },
        tiktok: null,
        snap: null,
        ga4: null,
        googleAds: { conversionId: "AW-123456789", labels: { contact: "c1" } },
      });
    });
  });

  describe("tenant isolation", () => {
    it("never shows, opens, updates or lists another shop's connection", async () => {
      const s = setup();
      value(await s.save.execute(input()));
      const other = value(await s.list.execute({ tenantId: "t-2" }));
      expect(other.every((v) => v.version === 0 && !v.enabled)).toBe(true);
      expect(await s.connections.get("t-2", "meta")).toBeNull();
      expect(await s.connections.list("t-2")).toEqual([]);
      expect(value(await s.live.execute({ tenantId: "t-2" }))).toEqual([]);
      const opened = await s.open.execute({ tenantId: "t-2", platform: "meta" });
      expect(opened.ok === false && opened.error.code).toBe("NOT_FOUND");
      const foreignUpdate = await s.save.execute(
        input({ tenantId: "t-2", secret: "", expectedVersion: 1 }),
      );
      expect(foreignUpdate.ok === false && foreignUpdate.error.code).toBe("CONCURRENCY");
      // t-2 can have its own meta connection next to t-1's
      const own = value(
        await s.save.execute(input({ tenantId: "t-2", secret: "OTHERTOKEN-1234567" })),
      );
      expect(own.secret.last4).toBe("4567");
      expect(value(await s.open.execute({ tenantId: "t-1", platform: "meta" }))).toBe(SECRET);
    });
  });
}
