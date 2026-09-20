import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import {
  parseStorageKey,
  resolveBucket,
  StorageKeyFactory,
  storageKeyBelongsToTenant,
} from "./keys";

const clock: Clock = { now: () => new Date("2026-07-05T12:00:00.000Z") };
const ids: IdGenerator = { generate: () => "0198f9aa-0000-7000-8000-000000000001" };
const factory = new StorageKeyFactory({ idGenerator: ids, clock });

describe("StorageKeyFactory", () => {
  it("builds tenant-prefixed, time-bucketed, uuid-leaf keys", () => {
    const key = factory.build({
      tenantId: "t-1",
      namespace: "product-images",
      filename: "wagon.PNG",
    });
    expect(key).toBe("tenants/t-1/product-images/2026/07/0198f9aa-0000-7000-8000-000000000001.png");
  });

  it("never lets a hostile filename contribute path segments", () => {
    const key = factory.build({
      tenantId: "t-1",
      namespace: "customer-uploads",
      filename: "../../etc/passwd",
    });
    expect(key).toBe("tenants/t-1/customer-uploads/2026/07/0198f9aa-0000-7000-8000-000000000001");
    expect(key).not.toContain("..");
  });

  it("drops extensions that fail the allowlist pattern", () => {
    const key = factory.build({ tenantId: "t-1", namespace: "documents", filename: "report.p!d" });
    expect(key.endsWith("0198f9aa-0000-7000-8000-000000000001")).toBe(true);
  });

  it("rejects malformed tenant ids (isolation guard)", () => {
    expect(() => factory.build({ tenantId: "../t-2", namespace: "documents" })).toThrow(
      /invalid tenant id/,
    );
  });

  it("maps every namespace to its purpose bucket", () => {
    expect(resolveBucket("product-images")).toBe("media");
    expect(resolveBucket("audit-exports")).toBe("exports");
    expect(resolveBucket("imports")).toBe("imports");
    expect(resolveBucket("tmp")).toBe("imports");
    expect(resolveBucket("invoices")).toBe("media");
  });
});

describe("storage key ownership (G-68 / F-22)", () => {
  const own = "tenants/t-1/product-images/2026/07/0198f9aa-0000-7000-8000-000000000001.png";

  it("everything the factory produces parses back to its tenant", () => {
    for (const filename of [undefined, "wagon.PNG", "../../etc/passwd", "report.p!d"]) {
      const key = factory.build({ tenantId: "t-1", namespace: "documents", filename });
      expect(parseStorageKey(key)?.tenantId).toBe("t-1");
      expect(storageKeyBelongsToTenant(key, "t-1")).toBe(true);
    }
  });

  it("a key belongs to exactly one tenant", () => {
    expect(storageKeyBelongsToTenant(own, "t-1")).toBe(true);
    expect(storageKeyBelongsToTenant(own, "t-2")).toBe(false);
    // A tenant id that is a PREFIX of another must not match it.
    expect(storageKeyBelongsToTenant(own, "t")).toBe(false);
  });

  it.each([
    ["dot-dot segment", "tenants/t-2/../t-1/product-images/2026/07/id.png"],
    ["dot-dot in the leaf area", "tenants/t-1/product-images/2026/07/../../../t-2/x"],
    ["percent-encoded traversal", "tenants/t-1/product-images/2026/07/%2e%2e/id.png"],
    ["backslash separator", "tenants\\t-1\\product-images\\2026\\07\\id.png"],
    ["leading slash", "/tenants/t-1/product-images/2026/07/id.png"],
    ["trailing slash", "tenants/t-1/product-images/2026/07/id.png/"],
    ["double slash", "tenants/t-1//product-images/2026/07/id.png"],
    ["unknown namespace", "tenants/t-1/secrets/2026/07/id.png"],
    ["month out of range", "tenants/t-1/product-images/2026/13/id.png"],
    ["uppercase extension", "tenants/t-1/product-images/2026/07/id.PNG"],
    ["no tenants prefix (legacy)", "media/2026/07/id.png"],
    ["empty", ""],
  ])("rejects %s", (_label, key) => {
    expect(parseStorageKey(key)).toBeNull();
    expect(storageKeyBelongsToTenant(key, "t-1")).toBe(false);
    expect(storageKeyBelongsToTenant(key, "t-2")).toBe(false);
  });

  it("rejects an invalid tenant id instead of matching it", () => {
    expect(storageKeyBelongsToTenant(own, "")).toBe(false);
    expect(storageKeyBelongsToTenant(own, "t-1/../t-1")).toBe(false);
  });
});
