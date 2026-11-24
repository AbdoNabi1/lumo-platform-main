import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  isWhatsAppTemplateList,
  projectTemplate,
  type WhatsAppTemplateDto,
} from "@/lib/api/outreach";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { TestSendForm } from "./test-send-form";

const action = vi.hoisted(() => vi.fn());
vi.mock("@/app/settings/whatsapp/actions", () => ({ testSendAction: action }));
// `lib/api/outreach` is server-only in production; the guard is imported here only to prove the wire shape.
vi.mock("@/lib/api/client", () => ({ getAdminApi: vi.fn(), mutateAdminApi: vi.fn() }));

/** GET /outreach/whatsapp/templates, as the presenter writes it: a header variable and a URL button at index 2. */
const presenterBody = [
  {
    name: "order_update",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    rejectedReason: null,
    components: [
      { type: "HEADER", format: "TEXT", text: "Order {{1}}" },
      { type: "BODY", text: "Hi {{1}}, your order {{2}} shipped." },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Thanks" },
          { type: "PHONE_NUMBER", text: "Call", phone_number: "+201000000000" },
          { type: "URL", text: "Track", url: "https://shop.example/track/{{1}}" },
        ],
      },
    ],
    variableCount: 2,
    buttons: [
      { type: "QUICK_REPLY", text: "Thanks" },
      { type: "PHONE_NUMBER", text: "Call" },
      { type: "URL", text: "Track" },
    ],
    supported: true,
    sendShape: {
      bodyVariableCount: 2,
      headerHasVariable: true,
      buttons: [{ index: 2, type: "URL", urlHasVariable: true }],
    },
  },
  {
    name: "hello_plain",
    language: "ar",
    category: "UTILITY",
    status: "APPROVED",
    rejectedReason: null,
    components: [{ type: "BODY", text: "أهلاً" }],
    variableCount: 0,
    buttons: [],
    supported: true,
    sendShape: { bodyVariableCount: 0, headerHasVariable: false, buttons: [] },
  },
  {
    name: "two_body",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    rejectedReason: null,
    components: [{ type: "BODY", text: "{{1}} {{2}}" }],
    variableCount: 2,
    buttons: [],
    supported: true,
    sendShape: { bodyVariableCount: 2, headerHasVariable: false, buttons: [] },
  },
  {
    name: "still_pending",
    language: "en",
    category: "MARKETING",
    status: "PENDING",
    rejectedReason: null,
    components: [{ type: "BODY", text: "x" }],
    variableCount: 0,
    buttons: [],
    supported: true,
    sendShape: { bodyVariableCount: 0, headerHasVariable: false, buttons: [] },
  },
  {
    name: "media_header",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    rejectedReason: null,
    components: [
      { type: "HEADER", format: "IMAGE" },
      { type: "BODY", text: "x" },
    ],
    variableCount: 0,
    buttons: [],
    supported: false,
    sendShape: { bodyVariableCount: 0, headerHasVariable: false, buttons: [] },
  },
];

function wireTemplates(): readonly WhatsAppTemplateDto[] {
  const parsed: unknown = JSON.parse(JSON.stringify(presenterBody));
  if (!isWhatsAppTemplateList(parsed)) throw new Error("the presenter fixture failed the guard");
  return parsed.map(projectTemplate);
}

let keySeq = 0;
beforeEach(() => {
  expect.hasAssertions();
  action.mockReset();
  keySeq = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () => `00000000-0000-4000-8000-${String(++keySeq).padStart(12, "0")}`,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const result = (outcome: string, message = outcome) => ({ status: "result", outcome, message });

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}
function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}
function choose(name: string, t: Dictionary = en) {
  fireEvent.change(screen.getByLabelText(t.whatsappSettings.test.template), {
    target: { value: name },
  });
}
const submitButton = () => screen.getByRole("button", { name: en.whatsappSettings.test.submit });

/** Fills the plain `two_body` template for the given recipient. */
function fillTwoBody(to = "+201001234567", first = "Mona", second = "1001") {
  type(en.whatsappSettings.test.to, to);
  choose("two_body::en");
  type("Body value 1", first);
  type("Body value 2", second);
}
// `waitFor` helper: wait until the form is idle again (the transition finished).
async function submitAndSettle() {
  const before = action.mock.calls.length;
  fireEvent.click(submitButton());
  await waitFor(() => expect(action.mock.calls.length).toBe(before + 1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Send test message|Sending/ })).toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: en.whatsappSettings.test.submitting })).toBeNull(),
  );
}

describe("the template list", () => {
  it("lists only APPROVED templates that are supported", () => {
    expect.hasAssertions();
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    const select = screen.getByLabelText(en.whatsappSettings.test.template);
    const labels = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).toEqual([
      en.whatsappSettings.test.templatePlaceholder,
      "order_update · en",
      "hello_plain · ar",
      "two_body · en",
    ]);
    expect(labels.join("|")).not.toMatch(/still_pending|media_header/);
  });

  it("says so when no template can be used", () => {
    expect.hasAssertions();
    render(
      <TestSendForm templates={wireTemplates().filter((x) => x.status !== "APPROVED")} t={en} />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(en.whatsappSettings.test.noTemplates);
    expect(screen.queryByRole("button", { name: en.whatsappSettings.test.submit })).toBeNull();
  });
});

describe("inputs follow the presenter's sendShape (R2-B06)", () => {
  it("presenter JSON → guard → the form renders the body, header and URL-suffix inputs", () => {
    expect.hasAssertions();
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    choose("order_update::en");
    expect(field("Body value 1")).toBeInTheDocument();
    expect(field("Body value 2")).toBeInTheDocument();
    expect(field(en.whatsappSettings.test.headerValue)).toBeInTheDocument();
    // The URL button is at index 2, shown as the third button.
    expect(field("Link ending for button 3")).toBeInTheDocument();
    expect(screen.queryByLabelText("Body value 3")).toBeNull();
    expect(screen.queryByLabelText("Link ending for button 1")).toBeNull();
  });

  it("a template without variables has no value inputs", () => {
    expect.hasAssertions();
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    choose("hello_plain::ar");
    expect(screen.queryByLabelText(/Body value/)).toBeNull();
    expect(screen.queryByLabelText(en.whatsappSettings.test.headerValue)).toBeNull();
    expect(screen.queryByLabelText(/Link ending/)).toBeNull();
  });

  it("sends the body values, the header and the URL suffix keyed by the button index", async () => {
    expect.hasAssertions();
    action.mockResolvedValue(result("accepted", en.whatsappSettings.test.resultAccepted));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    type(en.whatsappSettings.test.to, " +20 100 123 4567 ");
    choose("order_update::en");
    type("Body value 1", "Mona");
    type("Body value 2", "1001");
    type(en.whatsappSettings.test.headerValue, "1001");
    type("Link ending for button 3", "abc123");
    await submitAndSettle();
    expect(action).toHaveBeenCalledWith({
      to: "+20 100 123 4567",
      templateName: "order_update",
      language: "en",
      values: { body: ["Mona", "1001"], header: "1001", urlSuffixes: { "2": "abc123" } },
      idempotencyKey: uuid(1),
    });
  });

  it("stays disabled until every value is filled and the number looks valid", () => {
    expect.hasAssertions();
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    expect(submitButton()).toBeDisabled();
    type(en.whatsappSettings.test.to, "abc");
    expect(screen.getByText(en.whatsappSettings.test.toInvalid)).toBeInTheDocument();
    expect(field(en.whatsappSettings.test.to)).toHaveAttribute("aria-invalid", "true");
    type(en.whatsappSettings.test.to, "+201001234567");
    choose("two_body::en");
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(en.whatsappSettings.test.valueRequired)).toBeInTheDocument();
    type("Body value 1", "a");
    expect(submitButton()).toBeDisabled();
    type("Body value 2", "b");
    expect(submitButton()).toBeEnabled();
  });
});

describe("results (never 'Sent' on HTTP 200)", () => {
  it.each([
    ["accepted", en.whatsappSettings.test.resultAccepted],
    ["suppressed", en.whatsappSettings.test.resultSuppressed],
    ["unknown", en.whatsappSettings.test.resultUnknown],
    ["failed", en.whatsappSettings.test.resultFailed],
  ])("shows the %s copy", async (outcome, message) => {
    expect.hasAssertions();
    action.mockResolvedValue(result(outcome, message));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody();
    await submitAndSettle();
    const line = await screen.findByText(
      (_c, el) => el?.tagName === "P" && el.textContent === message,
    );
    expect(line).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bSent\b/);
  });

  it("the explicit copy table", () => {
    expect.hasAssertions();
    expect(en.whatsappSettings.test.resultAccepted).toBe("Accepted by WhatsApp");
    expect(en.whatsappSettings.test.resultSuppressed).toBe(
      "Not sent: this customer hasn't agreed to messages / opted out",
    );
    expect(en.whatsappSettings.test.resultUnknown).toBe(
      "We couldn't confirm the result. Don't resend; check again in a few minutes.",
    );
  });

  it("shows an action error as an alert", async () => {
    expect.hasAssertions();
    action.mockResolvedValue({
      status: "error",
      message: en.whatsappSettings.errors.WHATSAPP_NOT_CONNECTED,
    });
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody();
    await submitAndSettle();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappSettings.errors.WHATSAPP_NOT_CONNECTED,
    );
  });
});

describe("idempotency key lifecycle (R2-B14)", () => {
  it.each([
    "Body value 1",
    en.whatsappSettings.test.headerValue,
    "Link ending for button 3",
    en.whatsappSettings.test.attest,
  ])("freezes %s after an unresolved submission and retries the exact request", async (label) => {
    expect.hasAssertions();
    action.mockResolvedValue({ status: "error", message: "network" });
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    type(en.whatsappSettings.test.to, "+201001234567");
    choose("order_update::en");
    type("Body value 1", "Mona");
    type("Body value 2", "1001");
    type(en.whatsappSettings.test.headerValue, "header");
    type("Link ending for button 3", "url");
    await submitAndSettle();
    expect(screen.getByLabelText(label)).toBeDisabled();
    await submitAndSettle();
    expect(action.mock.calls[1]![0]).toEqual(action.mock.calls[0]![0]);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
  });
  it("is created when the form mounts, once", () => {
    expect.hasAssertions();
    const spy = vi.spyOn(globalThis.crypto, "randomUUID");
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    expect(spy).toHaveBeenCalledTimes(1);
    type(en.whatsappSettings.test.to, "+201001234567");
    choose("two_body::en");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a transport retry of the same request reuses the key", async () => {
    expect.hasAssertions();
    action
      .mockResolvedValueOnce({ status: "error", message: en.whatsappSettings.errors.generic })
      .mockResolvedValueOnce(result("accepted", en.whatsappSettings.test.resultAccepted));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody();
    await submitAndSettle();
    expect(submitButton()).toBeEnabled(); // an error is not a verdict: the retry is allowed
    await submitAndSettle();
    const keys = action.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual([uuid(1), uuid(1)]);
  });

  it("after accepted, the next submission gets a new key and the form is clear", async () => {
    expect.hasAssertions();
    action.mockResolvedValue(result("accepted", en.whatsappSettings.test.resultAccepted));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody();
    await submitAndSettle();
    expect(field(en.whatsappSettings.test.to).value).toBe("");
    fillTwoBody();
    await submitAndSettle();
    const keys = action.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual([uuid(1), uuid(2)]);
  });

  it("after suppressed, ticking the attestation is a NEW submission with a new key and attestConsent", async () => {
    expect.hasAssertions();
    action
      .mockResolvedValueOnce(result("suppressed", en.whatsappSettings.test.resultSuppressed))
      .mockResolvedValueOnce(result("accepted", en.whatsappSettings.test.resultAccepted));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody();
    await submitAndSettle();
    // Zero dispatch: the merchant is asked to attest, and cannot resubmit until they do.
    expect(screen.getByText(en.whatsappSettings.test.attestHint)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/The customer agreed to receive/));
    expect(submitButton()).toBeEnabled();
    await submitAndSettle();
    const calls = action.mock.calls.map((call) => call[0] as Record<string, unknown>);
    expect(calls[0]).not.toHaveProperty("attestConsent");
    expect(calls[1]).toMatchObject({ attestConsent: true, idempotencyKey: uuid(2) });
    expect(calls[0]!["idempotencyKey"]).toBe(uuid(1));
  });

  it.each(["failed", "unknown"])(
    "after %s the key is kept, resubmit is disabled for that recipient + template, and there is no Try again",
    async (outcome) => {
      expect.hasAssertions();
      action.mockResolvedValue(result(outcome, outcome));
      render(<TestSendForm templates={wireTemplates()} t={en} />);
      fillTwoBody();
      await submitAndSettle();
      expect(submitButton()).toBeDisabled();
      expect(screen.getByText(en.whatsappSettings.test.blockedHint)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /try again|retry|resend/i })).toBeNull();
      // The key was neither regenerated nor replaced.
      expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
      // Changing only a value does not unblock the same recipient + template.
      type("Body value 1", "Someone else");
      expect(submitButton()).toBeDisabled();
      // A second click on the disabled button reaches nothing.
      fireEvent.click(submitButton());
      expect(action).toHaveBeenCalledTimes(1);
    },
  );

  it("changing the recipient re-enables the form, and that is a new submission with a new key", async () => {
    expect.hasAssertions();
    action.mockResolvedValue(result("unknown", "unknown"));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody("+201001234567");
    await submitAndSettle();
    expect(submitButton()).toBeDisabled();
    type(en.whatsappSettings.test.to, "+201112223334");
    expect(submitButton()).toBeEnabled();
    await submitAndSettle();
    const keys = action.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual([uuid(1), uuid(2)]);
  });

  it("changing the template also re-enables the form", async () => {
    expect.hasAssertions();
    action.mockResolvedValue(result("failed", "failed"));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody();
    await submitAndSettle();
    expect(submitButton()).toBeDisabled();
    choose("hello_plain::ar");
    expect(submitButton()).toBeEnabled();
  });

  it("changing back to a blocked recipient + template stays blocked", async () => {
    expect.hasAssertions();
    action.mockResolvedValue(result("unknown", "unknown"));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody("+201001234567");
    await submitAndSettle();
    type(en.whatsappSettings.test.to, "+201112223334");
    expect(submitButton()).toBeEnabled();
    type(en.whatsappSettings.test.to, "+20 100 123 4567"); // the same number, formatted differently
    expect(submitButton()).toBeDisabled();
  });

  it("a second click while a send is in flight does not send twice", async () => {
    expect.hasAssertions();
    let release: (value: unknown) => void = () => undefined;
    action.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody();
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.whatsappSettings.test.submitting }),
      ).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: en.whatsappSettings.test.submitting }));
    expect(action).toHaveBeenCalledTimes(1);
    release(result("accepted", en.whatsappSettings.test.resultAccepted));
    await waitFor(() => expect(screen.queryByText(en.whatsappSettings.test.submitting)).toBeNull());
  });
});

describe("layout direction and brand isolation", () => {
  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)(
    "keeps phone and URL inputs LTR in %s and isolates the brand name",
    (_locale, t: Dictionary) => {
      expect.hasAssertions();
      render(<TestSendForm templates={wireTemplates()} t={t} />);
      choose("order_update::en", t);
      expect(field(t.whatsappSettings.test.to)).toHaveAttribute("dir", "ltr");
      expect(field(t.whatsappSettings.test.to)).toHaveClass("text-start");
      expect(field(t.whatsappSettings.test.urlSuffix.replace("{index}", "3"))).toHaveAttribute(
        "dir",
        "ltr",
      );
      const label = screen.getByText(
        (_c, el) => el?.tagName === "LABEL" && el.textContent === t.whatsappSettings.test.attest,
      );
      expect(label.querySelector("bdi")).toHaveAttribute("dir", "auto");
      expect(label.querySelector("bdi")).toHaveTextContent("WhatsApp");
    },
  );

  it("renders the Arabic copy", () => {
    expect.hasAssertions();
    render(<TestSendForm templates={wireTemplates()} t={ar} />);
    expect(screen.getByLabelText(ar.whatsappSettings.test.to)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.whatsappSettings.test.submit })).toBeDisabled();
  });
});

describe("non-disclosure", () => {
  it("never renders ids, provider text or the idempotency key", async () => {
    expect.hasAssertions();
    action.mockResolvedValue(result("accepted", en.whatsappSettings.test.resultAccepted));
    render(<TestSendForm templates={wireTemplates()} t={en} />);
    fillTwoBody();
    await submitAndSettle();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/wamid|outboundId|phoneNumberId|wabaId|00000000-0000/);
  });
});
