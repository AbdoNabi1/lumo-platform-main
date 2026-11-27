import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const page = await import("./page");
const AcceptInvitePage = page.default;

const TOKEN = "s3cr3t-token-value";

async function renderPage(params: { token?: string; store?: string; error?: string }) {
  render(await AcceptInvitePage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  expect.hasAssertions();
  redirectMock.mockClear();
  vi.stubEnv("AUTH_MODE", "native");
});

describe("/accept-invite", () => {
  it("never lets the link's token go on as a Referer header", () => {
    expect(page.metadata).toEqual({ referrer: "no-referrer" });
  });

  it("is only for native sign-in: anything else goes to /login", async () => {
    vi.stubEnv("AUTH_MODE", "ory");
    await expect(
      AcceptInvitePage({ searchParams: Promise.resolve({ token: TOKEN }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("shows the password form, posting to the submit route, with token and store hidden", async () => {
    await renderPage({ token: TOKEN, store: "acme" });
    const form = document.querySelector("form");
    expect(form).toHaveAttribute("action", "/accept-invite/submit");
    expect(form).toHaveAttribute("method", "post");
    const hidden = Array.from(form?.querySelectorAll<HTMLInputElement>("input[type=hidden]") ?? []);
    expect(hidden.map((input) => [input.name, input.value])).toEqual([
      ["token", TOKEN],
      ["store", "acme"],
    ]);
    const password = screen.getByLabelText(/^Password/);
    const confirm = screen.getByLabelText(/^Confirm/);
    for (const input of [password, confirm]) {
      expect(input).toHaveAttribute("type", "password");
      expect(input).toHaveAttribute("minlength", "8");
      expect(input).toHaveAttribute("maxlength", "256");
      expect(input).toHaveAttribute("autocomplete", "new-password");
    }
    expect(screen.getByRole("button", { name: /Create my account/ })).toBeInTheDocument();
  });

  it("leaves the store out when the link names none", async () => {
    await renderPage({ token: TOKEN });
    expect(document.querySelector("input[name=store]")).toBeNull();
  });

  it("never renders the token into visible text, a link or a label", async () => {
    await renderPage({ token: TOKEN, store: "acme", error: "mismatch" });
    expect(document.body.textContent).not.toContain(TOKEN);
    for (const link of Array.from(document.querySelectorAll("a"))) {
      expect(link.getAttribute("href")).not.toContain(TOKEN);
    }
    const attributes = Array.from(document.querySelectorAll("*")).flatMap((element) =>
      Array.from(element.attributes)
        .filter((attribute) => !(element.tagName === "INPUT" && attribute.name === "value"))
        .map((attribute) => attribute.value),
    );
    expect(attributes.join(" ")).not.toContain(TOKEN);
  });

  it("with no token it is the invalid-link state with no form", async () => {
    await renderPage({});
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This invitation link is invalid or has expired. Ask the store admin to resend it.",
    );
    expect(document.querySelector("form")).toBeNull();
    expect(screen.getByRole("link", { name: /Sign in/ })).toHaveAttribute("href", "/login");
  });

  it.each([
    [
      "invalid",
      "This invitation link is invalid or has expired. Ask the store admin to resend it.",
    ],
    ["mismatch", "The two passwords do not match"],
    ["weak", "Password must be 8–256 characters"],
    ["limited", "Too many attempts. Try again later."],
    ["unavailable", "Try again later"],
  ])("shows the %s message in English and Arabic", async (error, text) => {
    await renderPage({ token: TOKEN, error });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(alert.textContent).toMatch(/[\u0600-\u06FF]/);
  });

  it("an unknown error code shows nothing rather than echoing it", async () => {
    await renderPage({ token: TOKEN, error: "<script>alert(1)</script>" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.innerHTML).not.toContain("<script>");
  });
});
