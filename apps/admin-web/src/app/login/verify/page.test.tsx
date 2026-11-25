import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ challenge: { value: undefined as string | undefined } }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "morbeh_mfa_challenge" && mocks.challenge.value !== undefined
          ? { value: mocks.challenge.value }
          : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { default: LoginVerifyPage, metadata } = await import("./page");

const CHALLENGE = "eyJhbGciOiJFUzI1NiJ9.challenge.signature";

async function open(params: { error?: string; return_to?: string } = {}) {
  render(await LoginVerifyPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  mocks.challenge.value = CHALLENGE;
  vi.stubEnv("AUTH_MODE", "native");
});

describe("/login/verify", () => {
  it("renders a single numeric one-time-code input, Verify and a way back", async () => {
    await open();
    const input = screen.getByLabelText(/Authentication code/);
    expect(input).toHaveAttribute("name", "code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toBeRequired();
    expect(screen.getByRole("button", { name: /Verify/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to sign in/ })).toHaveAttribute("href", "/login");
    const form = input.closest("form");
    expect(form).toHaveAttribute("action", "/auth/native-login/verify");
    expect(form).toHaveAttribute("method", "post");
    expect(input).toHaveFocus();
  });

  it("toggles to a backup-code text input and back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Use a backup code/ }));
    const backup = screen.getByLabelText(/Backup code/);
    expect(backup).toHaveAttribute("name", "code");
    expect(backup).not.toHaveAttribute("inputmode", "numeric");
    expect(backup).toHaveAttribute("autocomplete", "off");
    expect(screen.queryByLabelText(/Authentication code/)).toBeNull();
    expect(backup).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /Use the authenticator app instead/ }));
    expect(screen.getByLabelText(/Authentication code/)).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText(/Authentication code/)).toHaveFocus();
  });

  it.each([
    ["code", /That code didn't work/],
    ["limited", /Too many attempts/],
    ["unavailable", /temporarily unavailable/],
  ])("shows the ?error=%s text", async (error, text) => {
    await open({ error });
    expect(screen.getByRole("alert")).toHaveTextContent(text);
  });

  it("shows no alert without an error and ignores an unknown one", async () => {
    await open({ error: "bogus" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("carries a safe return_to as a hidden field and defaults to /", async () => {
    await open({ return_to: "/orders" });
    expect(document.querySelector<HTMLInputElement>('input[name="return_to"]')?.value).toBe(
      "/orders",
    );
    cleanup();
    await open();
    expect(document.querySelector<HTMLInputElement>('input[name="return_to"]')?.value).toBe("/");
  });

  it("never renders the challenge (it lives only in the httpOnly cookie)", async () => {
    await open({ return_to: "/orders" });
    expect(document.body.innerHTML).not.toContain(CHALLENGE);
    expect(document.body.innerHTML).not.toContain("eyJ");
  });

  it("without the challenge cookie there is nothing to verify: redirect to /login", async () => {
    mocks.challenge.value = undefined;
    await expect(open()).rejects.toThrow("REDIRECT:/login");
    mocks.challenge.value = "";
    await expect(open()).rejects.toThrow("REDIRECT:/login");
  });

  it("?error=expired is a redirect to /login?error=expired", async () => {
    await expect(open({ error: "expired" })).rejects.toThrow("REDIRECT:/login?error=expired");
  });

  it("outside native sign-in it redirects to /login", async () => {
    vi.stubEnv("AUTH_MODE", "ory");
    await expect(open()).rejects.toThrow("REDIRECT:/login");
  });

  it("asks browsers not to send a Referer", () => {
    expect(metadata).toEqual({ referrer: "no-referrer" });
  });
});
