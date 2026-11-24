import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";

/**
 * Action → form lifecycle (I1) for creating a template. The REAL `createTemplateAction` and the REAL `mutateAdminApi`
 * sit between the form and a faked `fetch`, so the transport's exact in-flight 409 drives the key lifecycle: a retry
 * must be the identical request (same payload, same Idempotency-Key), never a second submission.
 */
const state = vi.hoisted(() => ({ locale: "en" as string | undefined }));
const mocks = vi.hoisted(() => ({ revalidatePath: vi.fn(), readSession: vi.fn(), push: vi.fn() }));
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ readSession: mocks.readSession }));

import { TemplateForm } from "./template-form";

const copy = en.whatsappTemplates;
const fetchMock = vi.fn();
let counter = 0;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const row = {
  name: "order_update",
  language: "en",
  category: "UTILITY",
  status: "PENDING",
  rejectedReason: null,
  components: [],
  variableCount: 0,
  buttons: [],
  supported: true,
  sendShape: { bodyVariableCount: 0, headerHasVariable: false, buttons: [] },
};
const conflict = (code: string) =>
  json(409, { code: "CONFLICT", message: code, retryable: false, fields: [] });
const inFlight = () =>
  json(409, {
    code: "CONFLICT",
    message: "A request with this Idempotency-Key is already in flight",
    retryable: true,
    fields: [],
  });

function wire(): { key: string; body: string }[] {
  return fetchMock.mock.calls.map((call) => {
    const [, init] = call as [string, RequestInit & { headers: Record<string, string> }];
    return { key: init.headers["idempotency-key"] ?? "", body: String(init.body) };
  });
}
const submitButton = () =>
  screen.getByRole("button", { name: new RegExp(`^(${copy.form.submit}|${copy.form.retry})$`) });

function fillValidDraft() {
  fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: "order_update" } });
  fireEvent.change(screen.getByLabelText(copy.form.body), {
    target: { value: "Your order is on its way today." },
  });
}
async function submit(expectedCalls: number) {
  await waitFor(() => expect(submitButton()).toBeEnabled());
  fireEvent.click(submitButton());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expectedCalls));
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

describe("create template: the transport's in-flight 409 (the same key is still running)", () => {
  it("is unresolved: generic copy, locked, and the retry is the IDENTICAL payload and key", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementationOnce(async () => inFlight());
    fetchMock.mockImplementation(async () => json(200, row));
    render(<TemplateForm t={en} locale="en" />);
    fillValidDraft();
    await submit(1);

    expect((await screen.findByRole("alert")).textContent).toBe(copy.form.lostResponse);
    expect(document.body).not.toHaveTextContent(/idempotency|in flight/i);
    expect(screen.getByLabelText(copy.form.name)).toBeDisabled();

    await submit(2);
    const calls = wire();
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[0]?.key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/settings/whatsapp/templates"));
  });
});

describe("create template: definitive refusals still release the submission", () => {
  it("a known refusal (name already exists) shows its copy, unlocks, and the next submit gets a NEW key", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementationOnce(async () => conflict("TEMPLATE_ALREADY_EXISTS"));
    fetchMock.mockImplementation(async () => conflict("TEMPLATE_ALREADY_EXISTS"));
    render(<TemplateForm t={en} locale="en" />);
    fillValidDraft();
    await submit(1);
    expect((await screen.findByRole("alert")).textContent).toContain(
      copy.errors.TEMPLATE_ALREADY_EXISTS,
    );
    await waitFor(() => expect(screen.getByLabelText(copy.form.name)).toBeEnabled());
    await submit(2);
    const calls = wire();
    expect(calls[1]?.body).toBe(calls[0]?.body);
    expect(calls[1]?.key).not.toBe(calls[0]?.key);
  });

  it("META_INVALID_RESPONSE (an HTTP 200 Meta may have processed) is unresolved: locked, no key rotation, identical retry", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementationOnce(async () => conflict("META_INVALID_RESPONSE"));
    fetchMock.mockImplementation(async () => json(200, row));
    render(<TemplateForm t={en} locale="en" />);
    fillValidDraft();
    await submit(1);
    expect((await screen.findByRole("alert")).textContent).toBe(copy.form.lostResponse);
    expect(document.body).not.toHaveTextContent(/META_|INVALID_RESPONSE/);
    expect(screen.getByLabelText(copy.form.name)).toBeDisabled();
    expect(screen.getByLabelText(copy.form.body)).toBeDisabled();
    await submit(2);
    const calls = wire();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[0]?.key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/settings/whatsapp/templates"));
  });

  it("a Meta 4xx refusal (META_100) is definitive: it unlocks and the next submit gets a NEW key", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => conflict("META_100"));
    render(<TemplateForm t={en} locale="en" />);
    fillValidDraft();
    await submit(1);
    await waitFor(() => expect(screen.getByLabelText(copy.form.name)).toBeEnabled());
    await submit(2);
    const calls = wire();
    expect(calls[1]?.body).toBe(calls[0]?.body);
    expect(calls[1]?.key).not.toBe(calls[0]?.key);
  });

  it("an unknown 409 is NOT proof of zero dispatch: it stays unresolved with the same key", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementationOnce(async () => conflict("SOMETHING_NEW"));
    fetchMock.mockImplementation(async () => json(200, row));
    render(<TemplateForm t={en} locale="en" />);
    fillValidDraft();
    await submit(1);
    expect((await screen.findByRole("alert")).textContent).toBe(copy.form.lostResponse);
    expect(screen.getByLabelText(copy.form.name)).toBeDisabled();
    await submit(2);
    const calls = wire();
    expect(calls[1]).toEqual(calls[0]);
  });
});
