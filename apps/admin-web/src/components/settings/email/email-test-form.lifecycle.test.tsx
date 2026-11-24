import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";

/**
 * Action → form lifecycle (I1). The form's key rules are only as good as the status the ACTION gives it, and the form
 * tests mock that status. Here the REAL `sendTestEmailAction` and the REAL `mutateAdminApi` sit between the form and a
 * faked `fetch`, so the exact API envelopes drive the key lifecycle: what the browser would really send twice.
 */
const state = vi.hoisted(() => ({ locale: "en" as string | undefined }));
const mocks = vi.hoisted(() => ({ revalidatePath: vi.fn(), readSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "morbeh-locale" && state.locale !== undefined
          ? { value: state.locale }
          : undefined,
    }),
}));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ readSession: mocks.readSession }));

import { EmailTestForm } from "./email-test-form";

const copy = en.emailSettings.test;
const fetchMock = vi.fn();
let counter = 0;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const conflict = (code: string) =>
  json(409, { code: "CONFLICT", message: code, retryable: false, fields: [] });
const inFlight = () =>
  json(409, {
    code: "CONFLICT",
    message: "A request with this Idempotency-Key is already in flight",
    retryable: true,
    fields: [],
  });
const sent = (status: string) =>
  json(200, {
    outboundId: "out-1",
    status,
    providerMessageId: null,
    acceptedAt: null,
    errorCode: null,
  });

/** What actually went over the wire, in order. */
function wire(): { to: string; key: string; body: string }[] {
  return fetchMock.mock.calls.map((call) => {
    const [, init] = call as [string, RequestInit & { headers: Record<string, string> }];
    return {
      to: (JSON.parse(String(init.body)) as { to: string }).to,
      key: init.headers["idempotency-key"] ?? "",
      body: String(init.body),
    };
  });
}

function setTo(value: string) {
  fireEvent.change(screen.getByLabelText(copy.to), { target: { value } });
}
function button() {
  return screen.getByRole("button", { name: new RegExp(`^(${copy.submit}|${copy.submitting})$`) });
}
async function send(expectedCalls: number) {
  await waitFor(() => expect(button()).toBeEnabled());
  fireEvent.click(button());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expectedCalls));
  await waitFor(() => expect(button().textContent).toBe(copy.submit));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  counter = 0;
  state.locale = "en";
  mocks.readSession.mockResolvedValue(null);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", {
    randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("409 SEND_OUTCOME_UNRECORDED (the email may have gone out)", () => {
  it("reads as UNKNOWN, keeps the key and never sends to the same address again", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => conflict("SEND_OUTCOME_UNRECORDED"));
    render(<EmailTestForm defaultTo="owner@example.com" t={en} />);
    await send(1);

    expect(await screen.findByRole("status")).toHaveTextContent(copy.resultUnknown);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button()).toBeDisabled();
    expect(screen.getByText(copy.blockedHint)).toBeInTheDocument();
    // The key was NOT released: no new key was made for a second send.
    expect(counter).toBe(1);

    // Pressing Enter / clicking cannot send again, even with a different spelling of the same address.
    fireEvent.submit(button().closest("form")!);
    setTo("OWNER@Example.com ");
    expect(button()).toBeDisabled();
    fireEvent.submit(button().closest("form")!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(counter).toBe(1);
  });

  it("only a DIFFERENT address can be sent to, and it gets its own key", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementationOnce(async () => conflict("SEND_OUTCOME_UNRECORDED"));
    fetchMock.mockImplementation(async () => sent("accepted"));
    render(<EmailTestForm defaultTo="owner@example.com" t={en} />);
    await send(1);
    setTo("other@example.com");
    await send(2);
    const calls = wire();
    expect(calls[0]?.to).toBe("owner@example.com");
    expect(calls[1]?.to).toBe("other@example.com");
    expect(calls[1]?.key).not.toBe(calls[0]?.key);
  });
});

describe("the transport's in-flight 409 (the same key is still running)", () => {
  it("is unresolved: generic copy, locked, and 'Send test email' re-sends the IDENTICAL payload and key", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementationOnce(async () => inFlight());
    fetchMock.mockImplementation(async () => sent("accepted"));
    render(<EmailTestForm defaultTo="owner@example.com" t={en} />);
    await send(1);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.emailSettings.errors.generic);
    expect(document.body).not.toHaveTextContent(/idempotency|in flight/i);
    expect(screen.getByLabelText(copy.to)).toBeDisabled();
    expect(counter).toBe(1);

    await send(2);
    const calls = wire();
    expect(calls[1]).toEqual(calls[0]);
    expect(await screen.findByRole("status")).toHaveTextContent(copy.resultAccepted);

    // The answer was definitive: the NEXT submission is a new one.
    await send(3);
    expect(wire()[2]?.key).not.toBe(calls[0]?.key);
  });
});

describe("safe refusals stay definitive", () => {
  it.each([
    ["the cap", () => conflict("EMAIL_CAP_REACHED"), en.emailSettings.errors.EMAIL_CAP_REACHED],
    [
      "a configuration gap",
      () => conflict("EMAIL_NOT_CONFIGURED"),
      en.emailSettings.errors.EMAIL_NOT_CONFIGURED,
    ],
    [
      "a validation refusal",
      () => json(422, { code: "VALIDATION", message: "Invalid", retryable: false, fields: [] }),
      en.emailSettings.test.toInvalid,
    ],
  ] as const)(
    "%s releases the lock and the next submission gets a new key",
    async (_n, answer, message) => {
      expect.hasAssertions();
      fetchMock.mockImplementationOnce(async () => answer());
      fetchMock.mockImplementation(async () => sent("accepted"));
      render(<EmailTestForm defaultTo="owner@example.com" t={en} />);
      await send(1);
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByLabelText(copy.to)).toBeEnabled();
      expect(button()).toBeEnabled();
      await send(2);
      const calls = wire();
      expect(calls[1]?.key).not.toBe(calls[0]?.key);
      expect(calls[1]?.to).toBe(calls[0]?.to);
    },
  );
});
