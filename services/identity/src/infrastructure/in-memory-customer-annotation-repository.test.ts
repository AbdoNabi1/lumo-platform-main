import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Customer } from "../domain/customer";
import { Email } from "../domain/value-objects/email";
import { InMemoryCustomerAnnotationRepository } from "./in-memory-customer-annotation-repository";

describe("InMemoryCustomerAnnotationRepository", () => {
  it("isolates tenants, omits missing customers and replaces the whole tag set", async () => {
    expect.hasAssertions();
    const email = Email.create("x@example.com");
    if (!email.ok) throw new Error("fixture");
    const customer = Customer.register(
      UniqueEntityId.from("one"),
      email.value,
      "X",
      "event",
      new Date(0),
    );
    const repo = new InMemoryCustomerAnnotationRepository({
      customers: {
        findById: async (id, tenant) => (id === "one" && tenant === "a" ? customer : null),
      },
    });
    expect(await repo.setNote("one", "note", "a")).toBe(true);
    expect(await repo.setNote("one", "other", "b")).toBe(false);
    expect(await repo.replaceTags("missing", [], "a")).toBeNull();
    expect(
      await repo.replaceTags(
        "one",
        [
          { tag: "VIP", tagKey: "vip" },
          { tag: "Cairo", tagKey: "cairo" },
        ],
        "a",
      ),
    ).toEqual(["Cairo", "VIP"]);
    expect(await repo.replaceTags("one", [{ tag: "New", tagKey: "new" }], "a")).toEqual(["New"]);
    expect([...(await repo.annotationsOf(["one", "missing"], "a"))]).toEqual([
      ["one", { note: "note", tags: ["New"] }],
    ]);
    expect((await repo.annotationsOf(["one"], "b")).size).toBe(0);
    expect(await repo.replaceTags("one", [], "a")).toEqual([]);
  });

  it("keys results by every requested spelling of a uuid and keeps unknown/foreign/non-uuid ids absent", async () => {
    expect.hasAssertions();
    const lower = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const upper = lower.toUpperCase();
    const mixed = "AaAaAaAa-BbBb-CcCc-DdDd-EeEeEeEeEeEe";
    const email = Email.create("x@example.com");
    if (!email.ok) throw new Error("fixture");
    const customer = Customer.register(
      UniqueEntityId.from(lower),
      email.value,
      "X",
      "event",
      new Date(0),
    );
    const repo = new InMemoryCustomerAnnotationRepository({
      customers: {
        findById: async (id, tenant) => (id === lower && tenant === "a" ? customer : null),
      },
    });
    expect(await repo.setNote(upper, "n", "a")).toBe(true);
    expect(await repo.replaceTags(mixed, [{ tag: "VIP", tagKey: "vip" }], "a")).toEqual(["VIP"]);

    const read = await repo.annotationsOf(
      [upper, mixed, lower, "not-a-uuid", "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee"],
      "a",
    );

    const expected = { note: "n", tags: ["VIP"] };
    expect([...read]).toEqual([
      [upper, expected],
      [mixed, expected],
      [lower, expected],
    ]);
    expect((await repo.annotationsOf([upper], "b")).size).toBe(0);
  });
});
