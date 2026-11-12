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

  it("shows the store-ready notice after ?signup=done", () => {
    render(<NativeLoginForm error={undefined} returnTo={undefined} signup="done" />);
    expect(screen.getByRole("status").textContent).toMatch(/Your store is ready/);
  });
});
