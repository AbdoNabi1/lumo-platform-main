import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SetupAtLogin } from "./setup-at-login";

const ENROLLMENT = "0b8a4a06-3a0c-4b41-8d6b-6c1f5e5f6a11";
const KEY = {
  enrollmentId: ENROLLMENT,
  manualKey: "JBSWY3DPEHPK3PXP",
  provisioningUri: "otpauth://totp/Morbeh:a@b.co?secret=JBSWY3DPEHPK3PXP",
};
const CODES = Array.from(
  { length: 10 },
  (_, index) => `aaaa-bbbb-${String(index).padStart(4, "0")}`,
);

type Reply = { status: number; body: unknown };
const calls: { url: string; init: RequestInit | undefined }[] = [];
const replies = {
  start: { status: 200, body: KEY } as Reply,
  confirm: { status: 200, body: { backupCodes: CODES } } as Reply,
};

function json(reply: Reply): Response {
  return new Response(JSON.stringify(reply.body), { status: reply.status });
}

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  return json(url.endsWith("/start") ? replies.start : replies.confirm);
});

const confirmCalls = () => calls.filter((call) => call.url.endsWith("/confirm"));

async function open(returnTo = "/") {
  const navigate = vi.fn();
  render(<SetupAtLogin returnTo={returnTo} navigate={navigate} />);
  await screen.findByText(/Setup key/);
  return navigate;
}

function typeCode(value: string): HTMLInputElement {
  const input = screen.getByLabelText(/Authentication code/) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  calls.length = 0;
  replies.start = { status: 200, body: KEY };
  replies.confirm = { status: 200, body: { backupCodes: CODES } };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setup at sign-in — step 1", () => {
  it("fetches the key once from the start route and shows the explanation, the grouped key and the link", async () => {
    await open();
    expect(
      screen.getByText(/Your store requires two-step verification\. Set it up now\./),
    ).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy key/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open in authenticator app/ })).toHaveAttribute(
      "href",
      KEY.provisioningUri,
    );
    const input = screen.getByLabelText(/Authentication code/);
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("placeholder", "123456");
    expect(screen.getByText(/not the setup key/)).toBeInTheDocument();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/auth/native-login/setup/start");
    expect(calls[0]?.init?.method).toBe("POST");
    // Nothing secret goes in: the challenge is in the httpOnly cookie, which JS cannot read.
    expect(calls[0]?.init?.body).toBe("{}");
    expect(calls[0]?.url).not.toContain("?");
  });

  it("letters in the code field show the inline hint and send no request", async () => {
    await open();
    const input = typeCode("JBSWY3DPEHPK3PXP");
    expect(screen.getByRole("alert")).toHaveTextContent(
      /This looks like the setup key\. Enter the 6-digit number your app shows\./,
    );
    expect(input.value).toBe("33");
    const confirm = screen.getByRole("button", { name: /^Confirm/ });
    expect(confirm).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    // Even a paste that leaves exactly six digits is not sent while it looks like the key.
    typeCode("A1B2C3D4E5F6");
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(confirmCalls()).toHaveLength(0);
  });

  it("a wrong code shows the message, clears the field and stays on step 1", async () => {
    replies.confirm = { status: 401, body: { error: "code" } };
    await open();
    typeCode("123456");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code didn't work. Enter the 6-digit number your app shows now.",
    );
    expect((screen.getByLabelText(/Authentication code/) as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/Save your backup codes/)).toBeNull();
    expect(confirmCalls()).toHaveLength(1);
    expect(JSON.parse(String(confirmCalls()[0]?.init?.body))).toEqual({
      enrollmentId: ENROLLMENT,
      code: "123456",
    });
  });

  it("too many attempts says to wait", async () => {
    replies.confirm = { status: 429, body: { error: "limited" } };
    await open();
    typeCode("123456");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many attempts/);
  });

  it("an expired challenge on confirm goes back to the sign-in form", async () => {
    replies.confirm = { status: 401, body: { error: "expired" } };
    const navigate = await open();
    typeCode("123456");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login?error=expired"));
  });
});

describe("setup at sign-in — step 2 and Continue", () => {
  async function toCodes(returnTo = "/") {
    const navigate = await open(returnTo);
    typeCode("123456");
    fireEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    await screen.findByText(/Save your backup codes/);
    return navigate;
  }

  it("shows the 10 backup codes once, with Copy all and Download, and Continue is disabled until the box is ticked", async () => {
    await toCodes();
    const list = screen.getByRole("list", { name: /Backup codes/ });
    expect(list.querySelectorAll("li")).toHaveLength(10);
    expect(screen.getByRole("button", { name: /Copy all/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download \.txt/ })).toBeInTheDocument();
    const next = screen.getByRole("button", { name: /Continue to dashboard/ });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I saved my backup codes/));
    expect(next).toBeEnabled();
    // The key is gone from the page once the codes are up.
    expect(screen.queryByText("JBSW Y3DP EHPK 3PXP")).toBeNull();
  });

  it("keeps the codes in component state only: no cookie, no storage, no token on the page", async () => {
    const writeCookie = vi.spyOn(document, "cookie", "set");
    await toCodes();
    expect(writeCookie).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.body.innerHTML).not.toMatch(/accessToken|eyJ/);
    writeCookie.mockRestore();
  });

  it("Continue just navigates to the safe return_to, and the codes are gone from document.body", async () => {
    const navigate = await toCodes("/orders");
    fireEvent.click(screen.getByLabelText(/I saved my backup codes/));
    fireEvent.click(screen.getByRole("button", { name: /Continue to dashboard/ }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/orders");
    // Continue made no further request: the session cookie was set by the confirm route.
    expect(calls.map((call) => call.url)).toEqual([
      "/auth/native-login/setup/start",
      "/auth/native-login/setup/confirm",
    ]);
    for (const code of CODES) expect(document.body.textContent).not.toContain(code);
    expect(document.body.textContent).not.toContain("JBSWY3DPEHPK3PXP");
    expect(document.body.innerHTML).not.toContain(KEY.provisioningUri);
  });
});

describe("setup at sign-in — failures of the start", () => {
  it("an expired challenge goes back to the sign-in form", async () => {
    replies.start = { status: 401, body: { error: "expired" } };
    const navigate = vi.fn();
    render(<SetupAtLogin returnTo="/" navigate={navigate} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login?error=expired"));
  });

  it("an outage shows a message and Try again starts it again", async () => {
    replies.start = { status: 503, body: { error: "unavailable" } };
    render(<SetupAtLogin returnTo="/" navigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/);
    replies.start = { status: 200, body: KEY };
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await screen.findByText(/Setup key/);
    expect(calls.filter((call) => call.url.endsWith("/start"))).toHaveLength(2);
  });

  it("too many starts says to wait", async () => {
    replies.start = { status: 429, body: { error: "limited" } };
    render(<SetupAtLogin returnTo="/" navigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many attempts/);
  });

  it("a network failure is an outage, not a crash", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<SetupAtLogin returnTo="/" navigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/);
  });
});
