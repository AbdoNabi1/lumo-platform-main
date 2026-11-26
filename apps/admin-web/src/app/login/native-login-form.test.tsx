import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { NativeLoginForm } from "./native-login-form";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("NativeLoginForm sign-up entry", () => {
  it("links to /signup only when sign-up is enabled", () => {
    const { rerender } = render(
      <NativeLoginForm error={undefined} returnTo={undefined} signupEnabled />,
    );
    expect(screen.getByRole("link", { name: /Open your store/ }).getAttribute("href")).toBe(
      "/signup",
    );
    rerender(<NativeLoginForm error={undefined} returnTo={undefined} />);
    expect(screen.queryByRole("link", { name: /Open your store/ })).toBeNull();
  });

  it("names the brand in Arabic the way the Arabic dictionary does", () => {
    render(<NativeLoginForm error={undefined} returnTo={undefined} signupEnabled />);
    const link = screen.getByRole("link", { name: /Open your store/ });
    expect(link.textContent).toContain(ar.brand);
  });

  it("shows the account-ready notice after ?invited=1, in English and Arabic", () => {
    expect.hasAssertions();
    render(<NativeLoginForm error={undefined} returnTo={undefined} invited="1" />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toMatch(/Your account is ready\. Sign in\./);
    expect(notice.textContent).toMatch(/[\u0600-\u06FF]/);
  });

  it("shows no notice for any other ?invited value, and an error wins over the notice", () => {
    expect.hasAssertions();
    const { rerender } = render(
      <NativeLoginForm error={undefined} returnTo={undefined} invited="yes" />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<NativeLoginForm error="invalid" returnTo={undefined} invited="1" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the store-ready notice after ?signup=done, telling the merchant to set up two-step", () => {
    render(<NativeLoginForm error={undefined} returnTo={undefined} signup="done" />);
    const notice = screen.getByRole("status").textContent ?? "";
    expect(notice).toMatch(/Your store is ready\. Sign in to set up two-step verification\./);
    expect(notice).toMatch(/[\u0600-\u06FF]/);
  });
});

describe("NativeLoginForm two-step messages (Wave 1e)", () => {
  it("says the store requires two-step verification on ?error=mfa, in English and Arabic", () => {
    expect.hasAssertions();
    render(<NativeLoginForm error="mfa" returnTo={undefined} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "Your store requires two-step verification. Ask your store admin.",
    );
    expect(alert.textContent).toMatch(/[\u0600-\u06FF]/);
  });

  it("says the sign-in expired on ?error=expired, in English and Arabic", () => {
    expect.hasAssertions();
    render(<NativeLoginForm error="expired" returnTo={undefined} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Your sign-in expired. Start again.");
    expect(alert.textContent).toMatch(/[\u0600-\u06FF]/);
  });
});
