import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const content = vi.hoisted(() => ({ getPolicy: vi.fn() }));
vi.mock("@/lib/content", () => content);
const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  locale: "en" as "ar" | "en",
}));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => request.shell,
  getRequestLocale: async () => request.locale,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
const { default: PolicyPage, generateMetadata } = await import("./page");

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });
const UPDATED = "2026-11-04T10:00:00.000Z";
const refund = {
  type: "refund",
  body: { en: "## Returns\nWithin 14 days" },
  updatedAt: UPDATED,
};

beforeEach(() => {
  content.getPolicy.mockReset();
  request.shell = { ...FALLBACK_SHELL, storeName: "Nour" };
  request.locale = "en";
});

describe("/policies/[handle] (spec 2.8, Ruling 7)", () => {
  it("unknown handles are notFound with no Runtime call (Ruling 7, Review Focus 1)", async () => {
    for (const handle of [
      "refund",
      "constructor",
      "__proto__",
      "toString",
      "../products/x",
      "Refund-Policy",
      "refund-policy/",
      "",
    ]) {
      await expect(PolicyPage(params(handle)), handle).rejects.toThrow("NOT_FOUND");
      expect(await generateMetadata(params(handle))).toEqual({});
    }
    expect(content.getPolicy).not.toHaveBeenCalled();
  });

  it("asks for the policy type the slug names", async () => {
    content.getPolicy.mockResolvedValue({ status: "ok", value: refund });
    await PolicyPage(params("terms-of-service"));
    expect(content.getPolicy).toHaveBeenLastCalledWith("terms");
    await PolicyPage(params("contact-information"));
    expect(content.getPolicy).toHaveBeenLastCalledWith("contact");
  });

  it("a policy that is not set is notFound", async () => {
    content.getPolicy.mockResolvedValue({ status: "not-found" });
    await expect(PolicyPage(params("refund-policy"))).rejects.toThrow("NOT_FOUND");
    // A set row with no text in either language is not set either.
    content.getPolicy.mockResolvedValue({ status: "ok", value: { ...refund, body: {} } });
    await expect(PolicyPage(params("refund-policy"))).rejects.toThrow("NOT_FOUND");
  });

  it("a failed read is the unavailable panel, never a 404 (Task 8 M-4)", async () => {
    content.getPolicy.mockResolvedValue({ status: "error" });
    render(await PolicyPage(params("refund-policy")));
    expect(
      screen.getByRole("heading", { level: 1, name: en.content.unavailableTitle }),
    ).toBeInTheDocument();
    expect(screen.getByText(en.content.unavailable)).toBeInTheDocument();
    expect(screen.queryByText("Returns")).toBeNull();
  });

  it("renders the fixed title, the locale's last-updated date and the body", async () => {
    content.getPolicy.mockResolvedValue({ status: "ok", value: refund });
    render(await PolicyPage(params("refund-policy")));
    expect(screen.getByRole("heading", { level: 1, name: "Refund policy" })).toBeInTheDocument();
    const date = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date(UPDATED));
    const stamp = screen.getByText(new RegExp(`Last updated ${date}`));
    expect(stamp).toBeInTheDocument();
    expect(stamp.closest("time")).toHaveAttribute("datetime", UPDATED);
    expect(screen.getByRole("heading", { level: 2, name: "Returns" })).toBeInTheDocument();
    expect(screen.getByText("Within 14 days").tagName).toBe("P");
  });

  it("no date line when the policy has no updatedAt", async () => {
    content.getPolicy.mockResolvedValue({ status: "ok", value: { ...refund, updatedAt: null } });
    render(await PolicyPage(params("refund-policy")));
    expect(screen.queryByText(/Last updated/)).toBeNull();
  });

  it("an Arabic-only body shows in English too; the title follows the locale", async () => {
    content.getPolicy.mockResolvedValue({
      status: "ok",
      value: { ...refund, body: { ar: "## الاسترجاع\nخلال ١٤ يوماً" } },
    });
    render(await PolicyPage(params("refund-policy")));
    expect(screen.getByRole("heading", { level: 1, name: "Refund policy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "الاسترجاع" })).toBeInTheDocument();
  });

  it("Arabic: the Arabic title and an Arabic date", async () => {
    request.locale = "ar";
    content.getPolicy.mockResolvedValue({ status: "ok", value: refund });
    render(await PolicyPage(params("refund-policy")));
    expect(screen.getByRole("heading", { level: 1, name: "سياسة الاسترجاع" })).toBeInTheDocument();
    const date = new Intl.DateTimeFormat("ar", { dateStyle: "long" }).format(new Date(UPDATED));
    expect(
      screen.getByText(ar.content.lastUpdated.replace("{date}", date), { exact: true }),
    ).toBeInTheDocument();
  });

  it("merchant text never becomes markup", async () => {
    content.getPolicy.mockResolvedValue({
      status: "ok",
      value: { ...refund, body: { en: '<img src=x onerror="alert(1)"> [x](javascript:alert(1))' } },
    });
    const { container } = render(await PolicyPage(params("refund-policy")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("metadata: '<policy> | <store>'", async () => {
    content.getPolicy.mockResolvedValue({ status: "ok", value: refund });
    expect(await generateMetadata(params("terms-of-service"))).toEqual({
      title: { absolute: "Terms of service | Nour" },
    });
    request.shell = { ...FALLBACK_SHELL, storeName: " 50% off " };
    request.locale = "ar";
    expect(await generateMetadata(params("refund-policy"))).toEqual({
      title: { absolute: "سياسة الاسترجاع | 50 off" },
    });
    request.shell = FALLBACK_SHELL;
    expect(await generateMetadata(params("refund-policy"))).toEqual({
      title: { absolute: "سياسة الاسترجاع" },
    });
  });

  it("metadata: a failed read is noindex; a policy that is not set adds nothing", async () => {
    content.getPolicy.mockResolvedValue({ status: "error" });
    expect(await generateMetadata(params("refund-policy"))).toEqual({ robots: { index: false } });
    content.getPolicy.mockResolvedValue({ status: "not-found" });
    expect(await generateMetadata(params("refund-policy"))).toEqual({});
  });
});
