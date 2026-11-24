import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "@platform/utils";
import { sortTags } from "../domain/customer-annotations";
import { ConsentScope } from "../domain/value-objects/consent-scope";
import { CreateCustomer, type CreateCustomerInput } from "./create-customer.use-case";
import { buildCustomerFixture, TENANT_A, TENANT_B } from "./customer-profile-test-fixture";

function setup() {
  const fixture = buildCustomerFixture();
  const useCase = new CreateCustomer({
    customers: fixture.customers,
    annotations: fixture.annotations,
    unitOfWork: fixture.unitOfWork,
    idGenerator: fixture.idGenerator,
    clock: fixture.clock,
  });
  return { ...fixture, useCase };
}

const valid: CreateCustomerInput = { tenantId: TENANT_A, name: "Mona", email: "mona@example.com" };

function scope(value: string): ConsentScope {
  const parsed = ConsentScope.create(value);
  if (!parsed.ok) throw new Error("fixture scope");
  return parsed.value;
}

describe("CreateCustomer", () => {
  it("stores a full profile in ONE unit of work: phone, language, marketing consent, note, sorted tags", async () => {
    expect.hasAssertions();
    const t = setup();

    const result = await t.useCase.execute({
      ...valid,
      name: "  Mona  ",
      email: " Mona@Example.com ",
      phone: "010 1234-5678",
      language: "ar",
      note: "  hi  ",
      tags: ["VIP", " vip ", "Cairo"],
      marketingEmail: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const customer = await t.customers.findById(result.value.customerId, TENANT_A);
    expect(customer?.name).toBe("Mona");
    expect(customer?.email.value).toBe("mona@example.com");
    expect(customer?.phone).toBe("01012345678");
    expect(customer?.language).toBe("ar");
    expect(customer?.consentFor(scope("marketing"))).toBe(true);
    expect(customer?.consentFor(scope("marketing_sms"))).toBe(false);
    expect(customer?.consents).toHaveLength(1);
    const stored = await t.annotations.annotationsOf([result.value.customerId], TENANT_A);
    expect(stored.get(result.value.customerId)).toEqual({ note: "hi", tags: ["Cairo", "VIP"] });
    // One unit of work; save and both annotation writes share its transaction, save first.
    expect(t.unitOfWork.transactions).toHaveLength(1);
    const tx = t.unitOfWork.transactions[0];
    expect(t.saves).toEqual([{ tx, customerId: result.value.customerId }]);
    const writes = t.annotationCalls.filter((c) => c.method !== "annotationsOf");
    expect(writes.map((c) => c.method)).toEqual(["setNote", "replaceTags"]);
    expect(writes.every((c) => c.tx === tx)).toBe(true);
    expect(t.outboxTypes().filter((topic) => topic.includes("consent_changed"))).toHaveLength(1);
  });

  it("grants marketing_sms only for marketingSms and emits it as its own consent scope", async () => {
    expect.hasAssertions();
    const t = setup();

    const result = await t.useCase.execute({ ...valid, marketingSms: true, marketingEmail: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const customer = await t.customers.findById(result.value.customerId, TENANT_A);
    expect(customer?.consentFor(scope("marketing"))).toBe(false);
    expect(customer?.consentFor(scope("marketing_sms"))).toBe(true);
    expect(t.outboxText().some((text) => text.includes("marketing_sms"))).toBe(true);
  });

  it("writes no note or tag rows and no consent when none are given", async () => {
    expect.hasAssertions();
    const t = setup();

    const result = await t.useCase.execute({ ...valid, note: "   ", tags: [" ", ","] });

    expect(result.ok).toBe(true);
    expect(t.annotationCalls).toEqual([]);
    expect(t.outboxTypes().filter((topic) => topic.includes("consent_changed"))).toHaveLength(0);
  });

  it("rejects a duplicate email with CONFLICT and writes nothing", async () => {
    expect.hasAssertions();
    const t = setup();
    await t.seedCustomer("dup@example.com");

    const result = await t.useCase.execute({
      ...valid,
      email: "DUP@example.com",
      note: "n",
      tags: ["x"],
      marketingEmail: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ConflictError);
    expect(result.error.message).toBe("A customer with this email already exists");
    expect(t.saves).toEqual([]);
    expect(t.annotationCalls).toEqual([]);
    expect(t.outboxTypes().filter((topic) => topic.includes("consent_changed"))).toHaveLength(0);
  });

  it("allows the same email in another tenant", async () => {
    expect.hasAssertions();
    const t = setup();
    await t.seedCustomer("shared@example.com", TENANT_B);

    const result = await t.useCase.execute({ ...valid, email: "shared@example.com" });

    expect(result.ok).toBe(true);
  });

  it("returns ONE ValidationError listing every failing field, before any repository call", async () => {
    expect.hasAssertions();
    const t = setup();

    const result = await t.useCase.execute({
      tenantId: TENANT_A,
      name: "   ",
      email: "not-an-email",
      phone: "abc1234567",
      language: "fr" as never,
      note: "😀".repeat(5001),
      tags: Array.from({ length: 251 }, (_, i) => `tag-${i}`),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    const fields = (result.error as ValidationError).fields.map((issue) => issue.field);
    expect(fields).toEqual(["name", "phone", "language", "email", "note", "tags"]);
    expect(t.unitOfWork.transactions).toEqual([]);
    expect(t.saves).toEqual([]);
    expect(t.annotationCalls).toEqual([]);
  });

  it("returns invalid phone and empty name together in one VALIDATION", async () => {
    expect.hasAssertions();
    const t = setup();

    const result = await t.useCase.execute({ ...valid, name: "", phone: "12345" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect((result.error as ValidationError).fields.map((issue) => issue.field)).toEqual([
      "name",
      "phone",
    ]);
  });

  it("rejects a 256-code-point name and accepts 255 emoji", async () => {
    expect.hasAssertions();
    const t = setup();

    const tooLong = await t.useCase.execute({ ...valid, name: "😀".repeat(256) });
    const exact = await t.useCase.execute({ ...valid, name: "😀".repeat(255) });

    expect(tooLong.ok).toBe(false);
    expect(exact.ok).toBe(true);
  });

  it("accepts 250 distinct tags, rejects 251 distinct tags (counted after splitting and de-duplication)", async () => {
    expect.hasAssertions();
    const t = setup();
    const tags = (count: number) => Array.from({ length: count }, (_, i) => `tag-${i}`);

    const ok250 = await t.useCase.execute({ ...valid, tags: tags(250) });
    const bad251 = await t.useCase.execute({ ...valid, email: "b@example.com", tags: tags(251) });
    const dupes = await t.useCase.execute({
      ...valid,
      email: "c@example.com",
      tags: [...tags(250), "TAG-1", " tag-2 "],
    });
    const joined = await t.useCase.execute({
      ...valid,
      email: "d@example.com",
      tags: [tags(251).join(",")],
    });

    expect(ok250.ok).toBe(true);
    expect(bad251.ok).toBe(false);
    if (!bad251.ok) expect(bad251.error.code).toBe("VALIDATION");
    expect(dupes.ok).toBe(true);
    expect(joined.ok).toBe(false);
  });

  it("normalizes tags: 40 emoji ok, 41 rejected, trims, splits Latin and Arabic commas, drops blanks", async () => {
    expect.hasAssertions();
    const t = setup();

    const created = await t.useCase.execute({
      ...valid,
      tags: ["  VIP  ", "a, b، c", "", "   ", "😀".repeat(40)],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const stored = await t.annotations.annotationsOf([created.value.customerId], TENANT_A);
    expect(stored.get(created.value.customerId)?.tags).toEqual(
      sortTags(["😀".repeat(40), "a", "b", "c", "VIP"]),
    );

    const tooLong = await t.useCase.execute({
      ...valid,
      email: "e@example.com",
      tags: ["😀".repeat(41)],
    });
    expect(tooLong.ok).toBe(false);
  });

  it("accepts a note of exactly 5000 code points and rejects 5001", async () => {
    expect.hasAssertions();
    const t = setup();

    const exact = await t.useCase.execute({ ...valid, note: "😀".repeat(5000) });
    const over = await t.useCase.execute({
      ...valid,
      email: "o@example.com",
      note: "😀".repeat(5001),
    });

    expect(exact.ok).toBe(true);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect((over.error as ValidationError).fields.map((issue) => issue.field)).toEqual(["note"]);
    }
  });

  it("treats a blank phone as omitted on create", async () => {
    expect.hasAssertions();
    const t = setup();

    const result = await t.useCase.execute({ ...valid, phone: "   " });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await t.customers.findById(result.value.customerId, TENANT_A))?.phone).toBeNull();
  });

  it("propagates a failing annotation write so the unit of work can roll the create back", async () => {
    expect.hasAssertions();
    const t = setup();
    const failing = new CreateCustomer({
      customers: t.customers,
      annotations: {
        annotationsOf: t.annotations.annotationsOf,
        setNote: t.annotations.setNote,
        replaceTags: async () => {
          throw new Error("tag insert failed");
        },
      },
      unitOfWork: t.unitOfWork,
      idGenerator: t.idGenerator,
      clock: t.clock,
    });

    await expect(failing.execute({ ...valid, tags: ["x"], marketingEmail: true })).rejects.toThrow(
      "tag insert failed",
    );
    // Everything happened inside the one unit of work whose failure the real UoW rolls back.
    expect(t.unitOfWork.transactions).toHaveLength(1);
    expect(t.saves.every((s) => s.tx === t.unitOfWork.transactions[0])).toBe(true);
  });
});
