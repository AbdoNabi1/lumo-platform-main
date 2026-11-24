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
});
