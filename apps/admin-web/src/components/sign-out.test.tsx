import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AccountMenu } from "./account-menu";
import { SignOutLink } from "./sign-out-link";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

/**
 * `/logout` is a GET route that clears the session, so the control MUST be a plain anchor: a
 * `next/link` `<Link>` prefetches its target and would sign the user out by itself. `next/link` is
 * replaced with a marked stand-in so that "is not a Link" is an assertion, not an assumption.
 */
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href} data-next-link="">
      {children}
    </a>
  ),
}));

const user = { name: "owner@example.com", role: "Admin", initials: "OW" };

function expectPlainLogoutAnchor(el: HTMLElement) {
  expect(el.tagName).toBe("A");
  expect(el).toHaveAttribute("href", "/logout");
  expect(el).not.toHaveAttribute("data-next-link");
}

function openMenu(label: string) {
  // jsdom has no PointerEvent, so Radix's pointerdown path never fires; Enter on the trigger opens it.
  fireEvent.keyDown(screen.getByRole("button", { name: label }), { key: "Enter" });
}

describe("SignOutLink (sidebar + mobile nav)", () => {
  it.each([
    ["en", en],
    ["ar", ar],
  ])("renders a plain <a href=/logout> with the %s label", (_name, dict) => {
    render(<SignOutLink label={dict.topbar.signOut} />);
    expectPlainLogoutAnchor(screen.getByRole("link", { name: dict.topbar.signOut }));
  });

  it("uses the dictionary strings", () => {
    expect(en.topbar.signOut).toBe("Sign out");
    expect(ar.topbar.signOut).toBe("تسجيل الخروج");
  });
});

describe("AccountMenu (topbar avatar)", () => {
  it("shows the email and role, and a plain <a href=/logout> sign-out item", () => {
    render(<AccountMenu t={en} user={user} />);
    openMenu(en.topbar.account);

    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    const item = screen.getByRole("menuitem", { name: "Sign out" });
    expectPlainLogoutAnchor(item);
  });

  it("is localised in Arabic", () => {
    render(<AccountMenu t={ar} user={user} />);
    openMenu(ar.topbar.account);
    expectPlainLogoutAnchor(screen.getByRole("menuitem", { name: "تسجيل الخروج" }));
  });
});
