import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { CheckoutLink, hashLinkToken, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import { PrismaCheckoutLinkRepository } from "./prisma-checkout-link-repository";

const TENANT = "tenant-a";
const SESSION_1 = "01920000-0000-7000-8000-000000000001";
const SESSION_2 = "01920000-0000-7000-8000-000000000002";

function issue(id: string, session: string, now: Date) {
  return CheckoutLink.issue({
    id,
    purpose: "recovery",
    target: { checkoutSessionId: session },
    createdBy: "staff-op",
    now,
    ttlMs: RECOVERY_LINK_TTL_MS,
  });
}

function setup() {
  const fake = createFakePrisma();
  return { fake, repository: new PrismaCheckoutLinkRepository({ prisma: fake.database }) };
}

describe("PrismaCheckoutLinkRepository (over fake-prisma)", () => {
  it("stores the token's hash and never the token", async () => {
    const { fake, repository } = setup();
    const { link, token } = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(0));
    await repository.save(link, TENANT, fake.database);

    const rows = fake.rowsOf("checkoutLink");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tokenHash"]).toBe(hashLinkToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("finds a link by the hash of its token inside the shop", async () => {
    const { fake, repository } = setup();
    const { link, token } = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(0));
    await repository.save(link, TENANT, fake.database);

    const found = await repository.findByTokenHash(hashLinkToken(token), TENANT, fake.database);
    expect(found?.snapshot()).toEqual(link.snapshot());
    expect(found?.isNew).toBe(false);
    expect(await repository.findByTokenHash(token, TENANT, fake.database)).toBeNull();
  });

  it("updates a loaded link's claim fields without touching what it was issued with", async () => {
    const { fake, repository } = setup();
    const { link } = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(0));
    await repository.save(link, TENANT, fake.database);
    const loaded = await repository.findById(link.id, TENANT, fake.database);
    if (loaded === null) throw new Error("setup failed");
    loaded.recordClaim(new Date(1000), "result-1");
    await repository.save(loaded, TENANT, fake.database);

    const again = await repository.findById(link.id, TENANT, fake.database);
    expect(again?.claimCount).toBe(1);
    expect(again?.lastClaimedAt).toEqual(new Date(1000));
    expect(again?.resultCheckoutRef).toBe("result-1");
    expect(again?.tokenHash).toBe(link.tokenHash);
    expect(fake.rowsOf("checkoutLink")).toHaveLength(1);
  });

  it("lists the links of the given checkouts, newest first", async () => {
    const { fake, repository } = setup();
    const older = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(1000)).link;
    const newer = issue("01920000-0000-7000-8000-0000000000a2", SESSION_1, new Date(2000)).link;
    const other = issue("01920000-0000-7000-8000-0000000000a3", SESSION_2, new Date(3000)).link;
    for (const link of [older, newer, other]) await repository.save(link, TENANT, fake.database);

    const listed = await repository.listForSessions([SESSION_1], TENANT, fake.database);
    expect(listed.map((link) => link.id)).toEqual([newer.id, older.id]);
  });

  it("answers nothing for non-UUID ids without querying (UUID columns)", async () => {
    const { fake, repository } = setup();
    expect(await repository.findById("abc", TENANT, fake.database)).toBeNull();
    expect(await repository.listForSessions(["abc"], TENANT, fake.database)).toEqual([]);
  });

  it("refuses to write outside the unit of work", async () => {
    const { repository } = setup();
    const { link } = issue("01920000-0000-7000-8000-0000000000a1", SESSION_1, new Date(0));
    await expect(repository.save(link, TENANT)).rejects.toThrow(/unit of work/);
  });
});
