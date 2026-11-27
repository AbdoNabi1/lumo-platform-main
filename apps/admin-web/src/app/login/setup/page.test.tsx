import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ setup: { value: undefined as string | undefined } }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "morbeh_mfa_setup" && mocks.setup.value !== undefined
          ? { value: mocks.setup.value }
          : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
// The page hands the screen its props; the screen itself is exercised in setup-at-login.test.tsx.
vi.mock("./setup-at-login", () => ({
  SetupAtLogin: ({ returnTo }: { returnTo: string }) => (
    <div data-testid="screen" data-return-to={returnTo} />
  ),
}));

const { default: LoginSetupPage, metadata } = await import("./page");

const CHALLENGE = "eyJhbG...setup.sig";

async function open(params: { error?: string; return_to?: string } = {}) {
  render(await LoginSetupPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  mocks.setup.value = CHALLENGE;
  vi.stubEnv("AUTH_MODE", "native");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/login/setup", () => {
  it("renders the setup screen when the setup cookie is there, and never the challenge", async () => {
    await open();
    expect(screen.getByTestId("screen")).toHaveAttribute("data-return-to", "/");
    expect(document.body.innerHTML).not.toContain(CHALLENGE);
    expect(document.body.innerHTML).not.toContain("eyJ");
  });

  it("passes a safe return_to on and falls back to / for an unsafe one", async () => {
    await open({ return_to: "/orders?x=1" });
    expect(screen.getByTestId("screen")).toHaveAttribute("data-return-to", "/orders?x=1");
    cleanup();
    for (const bad of ["//evil.example", "https://evil.example/a", "/\\evil.example"]) {
      await open({ return_to: bad });
      expect(screen.getByTestId("screen")).toHaveAttribute("data-return-to", "/");
      cleanup();
    }
  });

  it("without the setup cookie there is nothing to set up: redirect to /login", async () => {
    mocks.setup.value = undefined;
    await expect(open()).rejects.toThrow("REDIRECT:/login");
    mocks.setup.value = "";
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
