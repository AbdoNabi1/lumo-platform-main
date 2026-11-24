import type { Database } from "@platform/db";
import { describe, expect, it } from "vitest";
import { createPrismaOutreach } from "./prisma-outreach-wiring";

describe("createPrismaOutreach", () => {
  it("wires every repository and a unit of work, scoping the directory to the platform tenant", async () => {
    expect.hasAssertions();
    const lookups: unknown[] = [];
    const prisma = {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $executeRaw: () => Promise.resolve(0),
          whatsAppPhoneDirectory: {
            findFirst: (args: unknown) => {
              lookups.push(args);
              return Promise.resolve(null);
            },
          },
        }),
    } as unknown as Database;

    const wired = createPrismaOutreach({
      prisma,
      clock: { now: () => new Date(0) },
      platformTenantId: "platform-1",
    });

    expect(Object.keys(wired).sort()).toEqual(
      [
        "connections",
        "contacts",
        "directory",
        "emailCounters",
        "inbound",
        "outbound",
        "templates",
        "unitOfWork",
        "unmatched",
      ].sort(),
    );
    expect(await wired.directory.find("100000000001")).toBeNull();
    expect(lookups).toEqual([{ where: { tenantId: "platform-1", phoneNumberId: "100000000001" } }]);
  });
});
