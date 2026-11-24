import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { EmailTestForm } from "./email-test-form";

const mocks = vi.hoisted(() => ({ sendTestEmailAction: vi.fn(), uuid: vi.fn() }));
vi.mock("@/app/settings/email/actions", () => ({ sendTestEmailAction: mocks.sendTestEmailAction }));

const copy = en.emailSettings.test;
let counter = 0;

function renderForm(defaultTo = "owner@example.com", t: Dictionary = en) {
  return render(<EmailTestForm defaultTo={defaultTo} t={t} />);
}
function setTo(value: string) {
  fireEvent.change(screen.getByLabelText(copy.to), { target: { value } });
}
function submitButton() {
  return screen.getByRole("button", { name: new RegExp(`^(${copy.submit}|${copy.submitting})$`) });
}
async function clickSubmit() {
  await waitFor(() => expect(submitButton()).toBeEnabled());
  fireEvent.click(submitButton());
}
const accepted = { status: "result", outcome: "accepted", message: copy.resultAccepted };
const failed = {
  status: "result",
  outcome: "failed",
  message: `${copy.resultFailed} ${en.emailSettings.errors.EMAIL_CAP_REACHED}`,
};
const unknown = { status: "result", outcome: "unknown", message: copy.resultUnknown };
const suppressed = { status: "result", outcome: "suppressed", message: copy.resultSuppressed };
const lost = { status: "error", message: en.emailSettings.errors.generic };
const refused = { status: "refused", message: en.emailSettings.errors.EMAIL_CAP_REACHED };

function call(index: number) {
  return mocks.sendTestEmailAction.mock.calls[index]?.[0] as { to: string; idempotencyKey: string };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  counter = 0;
  mocks.uuid.mockImplementation(
    () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  );
  vi.stubGlobal("crypto", {
    randomUUID: mocks.uuid,
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  mocks.sendTestEmailAction.mockReset().mockResolvedValue(accepted);
});

describe("prefill and validation", () => {
  it("prefills the address with the current user's email", () => {
    expect.hasAssertions();
    renderForm("me@nour.example");
    expect(screen.getByLabelText(copy.to)).toHaveValue("me@nour.example");
    expect(submitButton()).toBeEnabled();
  });

  it("an empty default leaves the field empty and the button disabled", () => {
    expect.hasAssertions();
    renderForm("");
    expect(screen.getByLabelText(copy.to)).toHaveValue("");
    expect(submitButton()).toBeDisabled();
  });

  it("flags an invalid address and keeps the button disabled", () => {
    expect.hasAssertions();
    renderForm("");
    setTo("not-an-email");
    expect(screen.getByLabelText(copy.to)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(copy.toInvalid)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    setTo("ok@example.com");
    expect(submitButton()).toBeEnabled();
  });

  it("keeps the address LTR and start-aligned", () => {
    expect.hasAssertions();
    renderForm();
    expect(screen.getByLabelText(copy.to)).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText(copy.to).className).toContain("text-start");
  });
});

describe("key lifecycle (R2-B14: same rule as the WhatsApp test send)", () => {
  it("accepted: a status line, and the NEXT submission gets a new key", async () => {
    expect.hasAssertions();
    renderForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(1));
    expect(call(0)).toEqual({
      to: "owner@example.com",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(copy.resultAccepted);
    expect(document.body).not.toHaveTextContent(/\bsent\b/i);
    await clickSubmit();
    await waitFor(() => expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(2));
    expect(call(1).idempotencyKey).not.toBe(call(0).idempotencyKey);
  });

  it("a transport failure locks the address and 'Send test email' re-sends the exact same request", async () => {
    expect.hasAssertions();
    mocks.sendTestEmailAction.mockResolvedValueOnce(lost);
    renderForm();
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(en.emailSettings.errors.generic);
    await waitFor(() => expect(screen.getByLabelText(copy.to)).toBeDisabled());
    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(counter).toBe(1);
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(2));
    expect(call(1)).toEqual(call(0));
    expect(await screen.findByRole("status")).toHaveTextContent(copy.resultAccepted);
  });

  it("a thrown call is also unresolved", async () => {
    expect.hasAssertions();
    mocks.sendTestEmailAction.mockRejectedValueOnce(new Error("socket hang up"));
    renderForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByLabelText(copy.to)).toBeDisabled());
    await clickSubmit();
    await waitFor(() => expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(2));
    expect(call(1)).toEqual(call(0));
  });

  it("editing is impossible while unresolved (no silent new key for the same recipient)", async () => {
    expect.hasAssertions();
    mocks.sendTestEmailAction.mockResolvedValueOnce(lost);
    renderForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByLabelText(copy.to)).toBeDisabled());
    expect(counter).toBe(1);
  });

  it.each([
    ["failed", failed],
    ["unknown", unknown],
  ] as const)(
    "%s keeps the key and blocks the same address until it changes",
    async (_name, outcome) => {
      expect.hasAssertions();
      mocks.sendTestEmailAction.mockResolvedValueOnce(outcome);
      renderForm();
      fireEvent.click(submitButton());
      await waitFor(() => expect(screen.getByText(copy.blockedHint)).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
      await waitFor(() => expect(submitButton()).toBeDisabled());
      expect(counter).toBe(1); // the key is KEPT, not rotated
      fireEvent.submit(submitButton().closest("form")!);
      expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(1);
      // The same address in another case or with spaces is still the same recipient.
      setTo("  OWNER@example.com ");
      expect(submitButton()).toBeDisabled();
      // A different address is a different request: it gets its own key.
      setTo("other@example.com");
      expect(submitButton()).toBeEnabled();
      fireEvent.click(submitButton());
      await waitFor(() => expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(2));
      expect(call(1).to).toBe("other@example.com");
      expect(call(1).idempotencyKey).not.toBe(call(0).idempotencyKey);
    },
  );

  it("changing the address back after a failure is still blocked for that recipient", async () => {
    expect.hasAssertions();
    mocks.sendTestEmailAction.mockResolvedValueOnce(failed).mockResolvedValueOnce(accepted);
    renderForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).toBeDisabled());
    setTo("other@example.com");
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(submitButton()).toBeEnabled());
    setTo("owner@example.com");
    expect(submitButton()).toBeDisabled();
  });

  it("suppressed is definitive (zero dispatch): the next submission gets a new key", async () => {
    expect.hasAssertions();
    mocks.sendTestEmailAction.mockResolvedValueOnce(suppressed);
    renderForm();
    fireEvent.click(submitButton());
    expect(await screen.findByRole("status")).toHaveTextContent(copy.resultSuppressed);
    expect(screen.queryByText(copy.blockedHint)).toBeNull();
    await clickSubmit();
    await waitFor(() => expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(2));
    expect(call(1).idempotencyKey).not.toBe(call(0).idempotencyKey);
  });

  it("a refusal (cap reached) is definitive: the mapped alert, the form is released, a new key next time", async () => {
    expect.hasAssertions();
    mocks.sendTestEmailAction.mockResolvedValueOnce(refused);
    renderForm();
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.emailSettings.errors.EMAIL_CAP_REACHED,
    );
    await waitFor(() => expect(screen.getByLabelText(copy.to)).toBeEnabled());
    await clickSubmit();
    await waitFor(() => expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(2));
    expect(call(1).idempotencyKey).not.toBe(call(0).idempotencyKey);
  });

  it("a double submit while pending sends once", async () => {
    expect.hasAssertions();
    let release!: (value: typeof accepted) => void;
    mocks.sendTestEmailAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderForm();
    const form = submitButton().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.sendTestEmailAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: copy.submitting })).toBeDisabled();
    release(accepted);
    await screen.findByRole("status");
  });

  it("a failed delivery reads as an alert, not as success", async () => {
    expect.hasAssertions();
    mocks.sendTestEmailAction.mockResolvedValueOnce(failed);
    renderForm();
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.resultFailed);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an unknown result says not to resend", async () => {
    expect.hasAssertions();
    mocks.sendTestEmailAction.mockResolvedValueOnce(unknown);
    renderForm();
    fireEvent.click(submitButton());
    expect(await screen.findByRole("status")).toHaveTextContent("Don't resend");
  });
});

describe("Arabic", () => {
  it("renders Arabic copy and an LTR address field", () => {
    expect.hasAssertions();
    renderForm("a@b.co", ar);
    expect(screen.getByLabelText(ar.emailSettings.test.to)).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("button", { name: ar.emailSettings.test.submit })).toBeInTheDocument();
  });
});
