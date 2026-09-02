import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { resolveBucket, StorageKeyFactory } from "./keys";

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
