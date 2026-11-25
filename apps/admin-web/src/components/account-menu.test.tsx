import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { AccountMenu } from "./account-menu";

const USER = { name: "me@shop.example", role: "Admin", initials: "ME" };

async function open(t: Dictionary, user: typeof USER & { canChangePassword?: boolean }) {
  render(<AccountMenu t={t} user={user} />);
  fireEvent.keyDown(screen.getByRole("button", { name: t.topbar.account }), { key: "Enter" });
  return await within(document.body).findByRole("menu");
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
});

describe("AccountMenu (Wave 1e)", () => {
  it("offers Two-step verification next to Change password under native sign-in", async () => {
    const menu = await open(en, { ...USER, canChangePassword: true });
    expect(within(menu).getByRole("menuitem", { name: en.topbar.changePassword })).toHaveAttribute(
      "href",
      "/account/password",
    );
    expect(within(menu).getByRole("menuitem", { name: en.topbar.twoStep })).toHaveAttribute(
      "href",
      "/account/security",
    );
  });

  it("offers neither outside native sign-in (the credential lives in Kratos)", async () => {
    const menu = await open(en, USER);
    expect(within(menu).queryByRole("menuitem", { name: en.topbar.twoStep })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: en.topbar.changePassword })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: en.topbar.signOut })).toBeInTheDocument();
  });

  it("reads in Arabic", async () => {
    const menu = await open(ar, { ...USER, canChangePassword: true });
    expect(within(menu).getByRole("menuitem", { name: ar.topbar.twoStep })).toHaveAttribute(
      "href",
      "/account/security",
    );
  });
});
