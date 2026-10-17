import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { default: SignupPage } = await import("./page");

async function renderPage(error?: string) {
  const ui = await SignupPage({ searchParams: Promise.resolve(error ? { error } : {}) });
  return render(ui);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_MODE", "native");
  vi.stubEnv("ADMIN_SIGNUP_ENABLED", "1");
});

describe("/signup", () => {
  it("is a 404 when sign-up is not enabled", async () => {
    vi.stubEnv("ADMIN_SIGNUP_ENABLED", "");
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is a 404 when sign-in is not native", async () => {
    vi.stubEnv("AUTH_MODE", "oidc");
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the form posting to /auth/signup with the three countries, Egypt first", async () => {
    const { container } = await renderPage();
    const form = container.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/auth/signup");
    expect(form?.getAttribute("method")).toBe("post");
    expect(container.querySelector("input[name=storeName]")).not.toBeNull();
    expect(container.querySelector("input[name=email][type=email]")).not.toBeNull();
    const password = container.querySelector("input[name=password]");
    expect(password?.getAttribute("type")).toBe("password");
    expect(password?.getAttribute("minlength")).toBe("8");
    const options = [...container.querySelectorAll("select[name=country] option")];
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["EG", "SA", "AE"]);
    expect(screen.getByRole("button", { name: /Create store/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Already have a store/ }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it.each([
    ["taken", /already has a store/],
    ["limited", /Too many attempts/],
    ["invalid", /Check your details/],
    ["unavailable", /isn't available right now/],
  ])("shows the %s error", async (error, text) => {
    await renderPage(error);
    expect(screen.getByRole("alert").textContent).toMatch(text);
  });

  it("shows no alert for an unknown error code", async () => {
    await renderPage("bogus");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
