// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  updateCustomerProfile: vi.fn(),
  setCustomerNote: vi.fn(),
  setCustomerTags: vi.fn(),
  changeMarketingConsent: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
);
const cookieLocale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/customers", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieLocale.value === undefined ? undefined : { value: cookieLocale.value }),
  }),
}));

const {
  changeMarketingConsentAction,
  createCustomerAction,
  setCustomerNoteAction,
  setCustomerTagsAction,
  updateCustomerProfileAction,
} = await import("./actions");

const IDLE = { status: "idle" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = "c-1";
const DUPLICATE = "A customer with this email already exists";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

const failures = [
  ["unauthorized", { outcome: "unauthorized" }, en.formErrors.unauthorized],
  ["forbidden", { outcome: "forbidden" }, en.formErrors.forbidden],
  ["not_found", { outcome: "not_found" }, en.formErrors.notFound],
  ["error", { outcome: "error", message: "boom" }, en.formErrors.unexpected],
] as const;

beforeEach(() => {
  expect.hasAssertions();
  cookieLocale.value = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createCustomerAction", () => {
  it("sends the whole form with a fresh key, revalidates list + detail, then redirects to the customer", async () => {
    api.createCustomer.mockResolvedValue({ outcome: "ok", data: { customerId: "c-9" } });

    await expect(
      createCustomerAction(
        IDLE,
        form({
          name: "Nour Hassan",
          email: "nour@example.com",
          phone: "+201001234567",
          language: "ar",
          note: "VIP",
          tags: "a, b",
          marketingEmail: "on",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/customers/c-9");

    expect(api.createCustomer).toHaveBeenCalledWith(
      {
        name: "Nour Hassan",
        email: "nour@example.com",
        phone: "+201001234567",
        language: "ar",
        note: "VIP",
        tags: ["a, b"],
        marketingEmail: true,
        marketingSms: false,
      },
      expect.stringMatching(UUID),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith("/customers/c-9");
    expect(redirect).toHaveBeenCalledWith("/customers/c-9");
    // Both revalidations happen BEFORE the redirect throws.
    const order = [
      ...revalidatePath.mock.invocationCallOrder,
      ...redirect.mock.invocationCallOrder,
    ];
    expect(order[order.length - 1]).toBe(redirect.mock.invocationCallOrder[0]);
  });

  it("omits blank phone, note, tags and language; both marketing assertions off by default", async () => {
    api.createCustomer.mockResolvedValue({ outcome: "ok", data: { customerId: "c-9" } });

    await expect(
      createCustomerAction(
        IDLE,
        form({
          name: "Nour",
          email: "n@example.com",
          phone: "  ",
          language: "",
          note: "",
          tags: "   ",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(api.createCustomer.mock.calls[0]![0]).toEqual({
      name: "Nour",
      email: "n@example.com",
      marketingEmail: false,
      marketingSms: false,
    });
  });

  it("mints a new idempotency key for every submit", async () => {
    api.createCustomer.mockResolvedValue({ outcome: "invalid", message: "x", fields: [] });

    await createCustomerAction(IDLE, form({ name: "A", email: "a@example.com" }));
    await createCustomerAction(IDLE, form({ name: "A", email: "a@example.com" }));

    const [first, second] = api.createCustomer.mock.calls.map((call) => call[1]);
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });

  it("maps the exact duplicate-email 409 to the email field, in the shop's language", async () => {
    api.createCustomer.mockResolvedValue({
      outcome: "conflict",
      message: DUPLICATE,
      code: "CONFLICT",
    });

    const state = await createCustomerAction(IDLE, form({ name: "N", email: "n@example.com" }));

    expect(state).toEqual({
      status: "error",
      message: en.customerForm.duplicateEmail,
      fieldErrors: { email: en.customerForm.duplicateEmail },
    });
    expect(en.customerForm.duplicateEmail).toBe("A customer with this email already exists.");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(redirect).not.toHaveBeenCalled();

    cookieLocale.value = "ar";
    const arabic = await createCustomerAction(IDLE, form({ name: "N", email: "n@example.com" }));
    expect(arabic).toEqual({
      status: "error",
      message: ar.customerForm.duplicateEmail,
      fieldErrors: { email: ar.customerForm.duplicateEmail },
    });
  });

  it("a non-duplicate 409 CONFLICT (idempotency-key contention) shows the locale's own try-again copy", async () => {
    api.createCustomer.mockResolvedValue({
      outcome: "conflict",
      message: "A request with this Idempotency-Key is already in flight",
      code: "CONFLICT",
    });
    const values = { name: "N", email: "n@example.com", phone: "0101", tags: "vip" };

    const state = await createCustomerAction(IDLE, form(values));

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.conflict,
      fieldErrors: {},
    });
    expect(en.formErrors.conflict).toBe("That didn't go through — try again.");
    // The entered values went to the API unchanged and nothing marks Email as a duplicate.
    expect(api.createCustomer.mock.calls[0]![0]).toMatchObject({
      name: "N",
      email: "n@example.com",
      phone: "0101",
      tags: ["vip"],
    });
    expect(state).not.toMatchObject({ fieldErrors: { email: expect.anything() } });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(redirect).not.toHaveBeenCalled();

    revalidatePath.mockClear();
    cookieLocale.value = "ar";
    const arabic = await createCustomerAction(IDLE, form(values));
    expect(arabic).toEqual({
      status: "error",
      message: ar.formErrors.conflict,
      fieldErrors: {},
    });
    expect(ar.formErrors.conflict).toBe("لم تكتمل العملية — حاول مرة أخرى.");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("a 409 without the CONFLICT code is left to the generic mapping (server message kept)", async () => {
    api.createCustomer.mockResolvedValue({ outcome: "conflict", message: "Rule says no" });

    const state = await createCustomerAction(IDLE, form({ name: "N", email: "n@example.com" }));

    expect(state).toEqual({ status: "error", message: "Rule says no", fieldErrors: {} });
  });

  it("a 422 puts each field's message on its own field", async () => {
    api.createCustomer.mockResolvedValue({
      outcome: "invalid",
      message: "Validation failed",
      fields: [
        { field: "phone", message: "Enter a valid phone number" },
        { field: "tags", message: "A tag can be at most 40 characters" },
      ],
    });

    const state = await createCustomerAction(
      IDLE,
      form({ name: "N", email: "n@example.com", phone: "x" }),
    );

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: {
        phone: "Enter a valid phone number",
        tags: "A tag can be at most 40 characters",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it.each(failures)(
    "%s: maps the outcome and revalidates the list",
    async (_name, result, message) => {
      api.createCustomer.mockResolvedValue(result);

      const state = await createCustomerAction(IDLE, form({ name: "N", email: "n@example.com" }));

      expect(state).toEqual({ status: "error", message, fieldErrors: {} });
      expect(revalidatePath).toHaveBeenCalledWith("/customers");
      expect(redirect).not.toHaveBeenCalled();
    },
  );
});

describe("updateCustomerProfileAction", () => {
  it("sends name, phone and language; blank phone / language become null", async () => {
    api.updateCustomerProfile.mockResolvedValue({ outcome: "ok", data: { customerId: ID } });

    const state = await updateCustomerProfileAction(
      ID,
      IDLE,
      form({ name: "Nour Hassan", phone: "", language: "" }),
    );

    expect(state).toEqual({ status: "success" });
    expect(api.updateCustomerProfile).toHaveBeenCalledWith(
      ID,
      { name: "Nour Hassan", phone: null, language: null },
      expect.stringMatching(UUID),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
  });

  it("sends a typed phone and language as given", async () => {
    api.updateCustomerProfile.mockResolvedValue({ outcome: "ok", data: { customerId: ID } });

    await updateCustomerProfileAction(
      ID,
      IDLE,
      form({ name: "N", phone: " +201001234567 ", language: "en" }),
    );

    expect(api.updateCustomerProfile.mock.calls[0]![1]).toEqual({
      name: "N",
      phone: "+201001234567",
      language: "en",
    });
  });

  it("refuses an unknown language without calling the API", async () => {
    const state = await updateCustomerProfileAction(ID, IDLE, form({ name: "N", language: "fr" }));

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { language: en.formErrors.invalid },
    });
    expect(api.updateCustomerProfile).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a 422 reaches fieldErrors and still revalidates both paths", async () => {
    api.updateCustomerProfile.mockResolvedValue({
      outcome: "invalid",
      message: "Validation failed",
      fields: [{ field: "name", message: "Enter a name" }],
    });

    const state = await updateCustomerProfileAction(ID, IDLE, form({ name: "" }));

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { name: "Enter a name" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
  });

  it.each(failures)(
    "%s: maps the outcome and revalidates both paths",
    async (_n, result, message) => {
      api.updateCustomerProfile.mockResolvedValue(result);

      const state = await updateCustomerProfileAction(ID, IDLE, form({ name: "N" }));

      expect(state).toEqual({ status: "error", message, fieldErrors: {} });
      expect(revalidatePath).toHaveBeenCalledWith("/customers");
      expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
    },
  );

  it("an idempotency contention 409 keeps its own message, not the duplicate-email one", async () => {
    api.updateCustomerProfile.mockResolvedValue({
      outcome: "conflict",
      message: "A request with this Idempotency-Key is already in flight",
      code: "CONFLICT",
    });

    const state = await updateCustomerProfileAction(ID, IDLE, form({ name: "N" }));

    expect(state).toEqual({
      status: "error",
      message: "A request with this Idempotency-Key is already in flight",
      fieldErrors: {},
    });
  });
});

describe("setCustomerNoteAction", () => {
  it("sets the note and revalidates both paths", async () => {
    api.setCustomerNote.mockResolvedValue({ outcome: "ok", data: { customerId: ID, note: "hi" } });

    const state = await setCustomerNoteAction(ID, IDLE, form({ note: "hi" }));

    expect(state).toEqual({ status: "success" });
    expect(api.setCustomerNote).toHaveBeenCalledWith(ID, "hi", expect.stringMatching(UUID));
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
  });

  it("an empty note clears it (null)", async () => {
    api.setCustomerNote.mockResolvedValue({ outcome: "ok", data: { customerId: ID, note: null } });

    await setCustomerNoteAction(ID, IDLE, form({ note: "" }));

    expect(api.setCustomerNote.mock.calls[0]![1]).toBeNull();
  });

  it("a 422 on note reaches fieldErrors", async () => {
    api.setCustomerNote.mockResolvedValue({
      outcome: "invalid",
      message: "Validation failed",
      fields: [{ field: "note", message: "A note can be at most 5000 characters" }],
    });

    const state = await setCustomerNoteAction(ID, IDLE, form({ note: "x" }));

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { note: "A note can be at most 5000 characters" },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
  });

  it.each(failures)(
    "%s: maps the outcome and revalidates both paths",
    async (_n, result, message) => {
      api.setCustomerNote.mockResolvedValue(result);

      const state = await setCustomerNoteAction(ID, IDLE, form({ note: "x" }));

      expect(state).toEqual({ status: "error", message, fieldErrors: {} });
      expect(revalidatePath).toHaveBeenCalledWith("/customers");
      expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
    },
  );
});

describe("setCustomerTagsAction", () => {
  it("replaces the tag set and revalidates both paths", async () => {
    api.setCustomerTags.mockResolvedValue({
      outcome: "ok",
      data: { customerId: ID, tags: ["VIP"] },
    });

    const state = await setCustomerTagsAction(ID, ["VIP"]);

    expect(state).toEqual({ status: "success" });
    expect(api.setCustomerTags).toHaveBeenCalledWith(ID, ["VIP"], expect.stringMatching(UUID));
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
  });

  it("an empty list clears every tag", async () => {
    api.setCustomerTags.mockResolvedValue({ outcome: "ok", data: { customerId: ID, tags: [] } });

    await setCustomerTagsAction(ID, []);

    expect(api.setCustomerTags.mock.calls[0]![1]).toEqual([]);
  });

  it("refuses a payload that is not a list of strings, without calling the API", async () => {
    const state = await setCustomerTagsAction(ID, "VIP" as unknown as readonly string[]);

    expect(state.status).toBe("error");
    expect(api.setCustomerTags).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a 422 reaches fieldErrors", async () => {
    api.setCustomerTags.mockResolvedValue({
      outcome: "invalid",
      message: "Validation failed",
      fields: [{ field: "tags", message: "At most 250 tags" }],
    });

    const state = await setCustomerTagsAction(ID, ["a"]);

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { tags: "At most 250 tags" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
  });

  it.each(failures)(
    "%s: maps the outcome and revalidates both paths",
    async (_n, result, message) => {
      api.setCustomerTags.mockResolvedValue(result);

      const state = await setCustomerTagsAction(ID, ["a"]);

      expect(state).toEqual({ status: "error", message, fieldErrors: {} });
      expect(revalidatePath).toHaveBeenCalledWith("/customers");
      expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
    },
  );
});

describe("changeMarketingConsentAction", () => {
  it.each([
    ["email", true, { email: true }],
    ["email", false, { email: false }],
    ["sms", true, { sms: true }],
    ["sms", false, { sms: false }],
  ] as const)("%s %s sends only that channel", async (channel, subscribed, body) => {
    api.changeMarketingConsent.mockResolvedValue({
      outcome: "ok",
      data: { customerId: ID, email: false, sms: false },
    });

    const state = await changeMarketingConsentAction(ID, channel, subscribed);

    expect(state).toEqual({ status: "success" });
    expect(api.changeMarketingConsent).toHaveBeenCalledWith(ID, body, expect.stringMatching(UUID));
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
  });

  it("refuses an unknown channel or a non-boolean value, without calling the API", async () => {
    const channel = await changeMarketingConsentAction(ID, "push" as unknown as "email", true);
    const value = await changeMarketingConsentAction(ID, "email", "yes" as unknown as boolean);

    expect(channel.status).toBe("error");
    expect(value.status).toBe("error");
    expect(api.changeMarketingConsent).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(failures)(
    "%s: maps the outcome and revalidates both paths",
    async (_n, result, message) => {
      api.changeMarketingConsent.mockResolvedValue(result);

      const state = await changeMarketingConsentAction(ID, "sms", true);

      expect(state).toEqual({ status: "error", message, fieldErrors: {} });
      expect(revalidatePath).toHaveBeenCalledWith("/customers");
      expect(revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
    },
  );

  it("speaks the shop's language (Arabic) for errors", async () => {
    cookieLocale.value = "ar";
    api.changeMarketingConsent.mockResolvedValue({ outcome: "forbidden" });

    const state = await changeMarketingConsentAction(ID, "email", true);

    expect(state).toEqual({
      status: "error",
      message: ar.formErrors.forbidden,
      fieldErrors: {},
    });
  });
});
