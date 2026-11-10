import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { ar } from "@/messages/ar";

const content = vi.hoisted(() => ({ getPage: vi.fn() }));
vi.mock("@/lib/content", () => content);
const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  locale: "ar" as "ar" | "en",
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
const { default: Page, generateMetadata } = await import("./page");

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });
const page = {
  handle: "about",
  title: { en: "About" },
  body: { en: "## Who we are\nA small shop" },
  metaDescription: { en: "Who we are" },
  updatedAt: "2026-11-04T10:00:00.000Z",
};

beforeEach(() => {
  content.getPage.mockReset();
  request.shell = { ...FALLBACK_SHELL, storeName: "Nour" };
  request.locale = "ar";
});

describe("/pages/[handle] (spec 2.8)", () => {
  it("a malformed handle is notFound without a read (Review Focus 5)", async () => {
    for (const handle of ["About", "a/b", "..", "a".repeat(101), "%2e%2e"]) {
      await expect(Page(params(handle))).rejects.toThrow("NOT_FOUND");
    }
    expect(content.getPage).not.toHaveBeenCalled();
  });

  it("a 404 read is notFound; a failed read is the unavailable panel", async () => {
    content.getPage.mockResolvedValue({ status: "not-found" });
    await expect(Page(params("about"))).rejects.toThrow("NOT_FOUND");
    content.getPage.mockResolvedValue({ status: "error" });
    render(await Page(params("about")));
    expect(screen.getByText(ar.content.unavailable)).toBeInTheDocument();
  });

  it("renders the title as h1 (dir=auto) and the body through RichText; the other locale fills in", async () => {
    content.getPage.mockResolvedValue({ status: "ok", value: page });
    render(await Page(params("about")));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("About");
    expect(h1).toHaveAttribute("dir", "auto");
    expect(h1.querySelector("bdi")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Who we are" })).toBeInTheDocument();
    expect(screen.getByText("A small shop").tagName).toBe("P");
    expect(content.getPage).toHaveBeenCalledWith("about");
  });

  it("a page without a body renders only its title", async () => {
    content.getPage.mockResolvedValue({ status: "ok", value: { ...page, body: {} } });
    const { container } = render(await Page(params("about")));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("About");
    expect(container.querySelector("p")).toBeNull();
  });

  it("metadata: '<title> | <store>', the meta description, nothing for a 404", async () => {
    content.getPage.mockResolvedValue({ status: "ok", value: page });
    expect(await generateMetadata(params("about"))).toEqual({
      title: { absolute: "About | Nour" },
      description: "Who we are",
    });
    request.shell = { ...FALLBACK_SHELL, storeName: "50% off" };
    content.getPage.mockResolvedValue({ status: "ok", value: { ...page, metaDescription: {} } });
    expect(await generateMetadata(params("about"))).toEqual({
      title: { absolute: "About | 50 off" },
    });
    request.shell = FALLBACK_SHELL;
    expect(await generateMetadata(params("about"))).toEqual({ title: { absolute: "About" } });
    content.getPage.mockResolvedValue({ status: "not-found" });
    expect(await generateMetadata(params("about"))).toEqual({});
    content.getPage.mockClear();
    expect(await generateMetadata(params("a/b"))).toEqual({});
    expect(content.getPage).not.toHaveBeenCalled();
  });
});
