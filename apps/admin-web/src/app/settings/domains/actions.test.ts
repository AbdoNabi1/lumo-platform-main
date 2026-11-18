import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const api = vi.hoisted(() => ({
  addMyDomain: vi.fn(),
  verifyMyDomain: vi.fn(),
  makeMyDomainPrimary: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const cookieValue = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock("@/lib/api/store-domains", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (cookieValue.locale === undefined ? undefined : { value: cookieValue.locale }),
    }),
}));

const { addDomainAction, verifyDomainAction, makeDomainPrimaryAction } = await import("./actions");
const { en } = await import("@/messages/en");
const { ar } = await import("@/messages/ar");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  return formData;
}

beforeEach(() => {
  cookieValue.locale = undefined;
  api.addMyDomain.mockReset().mockResolvedValue({ outcome: "ok", data: { id: "d1" } });
  api.verifyMyDomain.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  api.makeMyDomainPrimary.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidatePath.mockReset();
});

describe("addDomainAction", () => {
  it("adds the trimmed, lower-cased hostname with one idempotency key and refreshes the page", async () => {
    const state = await addDomainAction(idle, form({ hostname: "  WWW.Shop.Example.com " }));

    expect(state).toEqual({ status: "success" });
    expect(api.addMyDomain).toHaveBeenCalledTimes(1);
    expect(api.addMyDomain).toHaveBeenCalledWith("www.shop.example.com", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/settings/domains");
  });

  it("strips a pasted scheme and trailing slash", async () => {
    await addDomainAction(idle, form({ hostname: "https://shop.example.com/" }));

    expect(api.addMyDomain.mock.calls[0]?.[0]).toBe("shop.example.com");
  });

  it("refuses a blank hostname before any request", async () => {
    const state = await addDomainAction(idle, form({ hostname: "   " }));

    expect(state.status).toBe("error");
    expect(state.status === "error" && Object.keys(state.fieldErrors)).toEqual(["hostname"]);
    expect(api.addMyDomain).not.toHaveBeenCalled();
  });

  it("says the domain is already connected to a store on a 409", async () => {
    api.addMyDomain.mockResolvedValue({ outcome: "conflict", message: "in use" });

    const state = await addDomainAction(idle, form({ hostname: "shop.example.com" }));

    expect(state).toMatchObject({
      status: "error",
      message: en.domainsPage.errorAlreadyConnected,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers in the merchant's language", async () => {
    cookieValue.locale = "ar";
    api.addMyDomain.mockResolvedValue({ outcome: "conflict", message: "in use" });

    const state = await addDomainAction(idle, form({ hostname: "shop.example.com" }));

    expect(state).toMatchObject({ message: ar.domainsPage.errorAlreadyConnected });
  });

  it("projects the API's validation errors onto the hostname field", async () => {
    api.addMyDomain.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid hostname",
      fields: [{ field: "hostname", message: "is not a valid hostname" }],
    });

    const state = await addDomainAction(idle, form({ hostname: "not a host" }));

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { hostname: "is not a valid hostname" },
    });
  });
});

describe("verifyDomainAction", () => {
  it("verifies the domain and refreshes the page", async () => {
    const state = await verifyDomainAction(idle, form({ domainId: "d1" }));

    expect(state).toEqual({ status: "success" });
    expect(api.verifyMyDomain).toHaveBeenCalledWith("d1", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/settings/domains");
  });

  it("explains that DNS is not visible yet when verification is refused with a 409", async () => {
    api.verifyMyDomain.mockResolvedValue({ outcome: "conflict", message: "does not point" });

    const state = await verifyDomainAction(idle, form({ domainId: "d1" }));

    expect(state).toMatchObject({ status: "error", message: en.domainsPage.errorDnsNotReady });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports another store's domain as not found", async () => {
    api.verifyMyDomain.mockResolvedValue({ outcome: "not_found" });

    const state = await verifyDomainAction(idle, form({ domainId: "other" }));

    expect(state).toMatchObject({ status: "error", message: en.formErrors.notFound });
  });

  it("does nothing without a domain id", async () => {
    const state = await verifyDomainAction(idle, form({}));

    expect(state.status).toBe("error");
    expect(api.verifyMyDomain).not.toHaveBeenCalled();
  });
});

describe("makeDomainPrimaryAction", () => {
  it("makes the domain primary and refreshes the page", async () => {
    const state = await makeDomainPrimaryAction(idle, form({ domainId: "d1" }));

    expect(state).toEqual({ status: "success" });
    expect(api.makeMyDomainPrimary).toHaveBeenCalledWith("d1", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/settings/domains");
  });

  it("says only a connected domain can be primary when refused with a 409", async () => {
    api.makeMyDomainPrimary.mockResolvedValue({ outcome: "conflict", message: "x" });

    const state = await makeDomainPrimaryAction(idle, form({ domainId: "d1" }));

    expect(state).toMatchObject({ status: "error", message: en.domainsPage.errorNotVerified });
  });
});
