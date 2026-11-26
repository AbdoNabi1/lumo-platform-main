import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import {
  EMAIL_CONNECTION_KINDS,
  EMAIL_PROVIDER_CHOICES,
  type EmailConnectionActionResult,
  type EmailConnectionSnapshot,
} from "@/lib/notification-settings-model";
import {
  CONNECTION,
  EMAIL_CONNECTED,
  EMAIL_NONE_SMTP,
  EMAIL_SMTP_CONNECTED,
  EMAIL_SMTP_FAILED,
  EMAIL_SMTP_FLAG_OFF,
  EMAIL_FAILED,
  EMAIL_NONE,
  EMAIL_OFF,
  EMAIL_UNAVAILABLE,
} from "./test-fixtures";

const actions = vi.hoisted(() => ({
  saveEmailConnectionAction: vi.fn(),
  setEmailConnectionEnabledAction: vi.fn(),
  testEmailConnectionAction: vi.fn(),
  disconnectEmailConnectionAction: vi.fn(),
}));
vi.mock("@/app/settings/notifications/actions", () => actions);

const { EmailAccountCard } = await import("./email-account-card");

const copy = en.notificationSettings.email;
const KEY = "re_xxxxxxxxxxxxxxxx5678";
const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  for (const mock of Object.values(actions)) mock.mockReset();
});

/** Holds the snapshot the way the panel does, so a result moves the chip and the version. */
function Harness({
  initial,
  t = en,
}: {
  readonly initial: EmailConnectionSnapshot | null;
  readonly t?: Dictionary;
}) {
  const [email, setEmail] = useState(initial);
  return <EmailAccountCard email={email} onChange={setEmail} t={t} />;
}

function renderCard(initial: EmailConnectionSnapshot | null, t: Dictionary = en) {
  return render(<Harness initial={initial} t={t} />);
}

function success(snapshot: EmailConnectionSnapshot): EmailConnectionActionResult {
  return { status: "success", snapshot };
}

const chip = () => screen.getByTestId("email-status");
const fromInput = () => screen.getByLabelText(copy.fromLabel);
const keyInput = () => screen.getByLabelText(copy.keyLabel);

describe("Email account card: not connected", () => {
  it("shows the chip, the three-step how-to, Resend selected and the others coming soon", () => {
    renderCard(EMAIL_NONE);

    expect(chip()).toHaveTextContent(copy.statusNotConnected);
    const steps = within(screen.getByRole("region", { name: copy.howToTitle })).getAllByRole(
      "listitem",
    );
    expect(steps.map((step) => step.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      `${copy.howTo1} ${copy.howToLink1}`,
      `${copy.howTo2} ${copy.howToLink2}`,
      `${copy.howTo3} ${copy.howToLink3}`,
    ]);
    expect(screen.getByRole("link", { name: copy.howToLink2 })).toHaveAttribute(
      "href",
      "https://resend.com/domains",
    );
    expect(screen.getByRole("link", { name: copy.howToLink3 })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );

    const group = screen.getByRole("group", { name: copy.providerLabel });
    expect(within(group).getByRole("radio", { name: "Resend" })).toBeChecked();
    for (const name of ["SendGrid", "Brevo"]) {
      expect(within(group).getByRole("radio", { name: new RegExp(name) })).toBeDisabled();
    }
    expect(within(group).getAllByText(copy.comingSoon)).toHaveLength(2);
    // The mailbox option is listed too; without the server's SMTP switch it says why it is disabled.
    expect(within(group).getByRole("radio", { name: /Gmail \/ other mailbox/ })).toBeDisabled();
    expect(within(group).getByText(copy.needsUpgrade)).toBeInTheDocument();
  });

  it("starts empty, with a write-only key box and no Send test, switch or Disconnect yet", () => {
    renderCard(EMAIL_NONE);

    expect(fromInput()).toHaveValue("");
    expect(keyInput()).toHaveValue("");
    expect(keyInput()).toHaveAttribute("type", "password");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: copy.sendTest })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.disconnect })).toBeNull();
    expect(screen.getByText(copy.saveHint)).toBeInTheDocument();
  });

  it("refuses a missing key and a bad address without calling the server", () => {
    renderCard(EMAIL_NONE);

    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(screen.getByText(copy.fromInvalid)).toBeInTheDocument();
    expect(screen.getByText(copy.keyRequired)).toBeInTheDocument();

    fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(screen.queryByText(copy.fromInvalid)).toBeNull();
    expect(screen.getByText(copy.keyRequired)).toBeInTheDocument();
    expect(actions.saveEmailConnectionAction).not.toHaveBeenCalled();
  });

  it("connects: sends the key and a null first version, then shows Connected and clears the key", async () => {
    actions.saveEmailConnectionAction.mockResolvedValue(success(EMAIL_CONNECTED));
    renderCard(EMAIL_NONE);

    fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByRole("status")).toHaveTextContent(copy.savedConnected);
    expect(actions.saveEmailConnectionAction).toHaveBeenCalledWith({
      kind: "resend",
      fromEmail: "orders@shop.example",
      apiKey: KEY,
      expectedVersion: null,
    });
    expect(chip()).toHaveTextContent(copy.statusConnected);
    expect(keyInput()).toHaveValue("");
    expect(screen.getByText(copy.keyStored.replace("{last4}", "1234"))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(KEY);
  });

  it("disables Save and shows 'Connecting…' while the test mail is on its way", async () => {
    let finish: (result: EmailConnectionActionResult) => void = () => undefined;
    actions.saveEmailConnectionAction.mockReturnValue(
      new Promise<EmailConnectionActionResult>((resolve) => {
        finish = resolve;
      }),
    );
    renderCard(EMAIL_NONE);
    fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    const pending = await screen.findByRole("button", { name: copy.saving });
    expect(pending).toBeDisabled();
    finish(success(EMAIL_CONNECTED));
    await screen.findByRole("status");
  });

  it("shows a refused test mail as Failed with the provider's message, not as connected", async () => {
    actions.saveEmailConnectionAction.mockResolvedValue(success(EMAIL_FAILED));
    renderCard(EMAIL_NONE);
    fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.savedFailed);
    expect(chip()).toHaveTextContent(copy.statusFailed);
    const last = screen.getByTestId("email-last-error");
    expect(last).toHaveTextContent(EMAIL_FAILED.connection!.lastError!);
    expect(last.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(screen.queryByText(copy.savedConnected)).toBeNull();
  });

  it.each([
    ["rate-limited", { status: "rate_limited" }, copy.rateLimited],
    ["unavailable", { status: "unavailable" }, copy.unavailable],
    [
      "a conflict",
      { status: "conflict", message: en.notificationSettings.conflict },
      en.notificationSettings.conflict,
    ],
    [
      "refused",
      { status: "error", message: en.formErrors.unexpected, fieldErrors: {} },
      en.formErrors.unexpected,
    ],
  ] as const)(
    "shows the message when saving is %s and keeps what was typed",
    async (_label, result, message) => {
      actions.saveEmailConnectionAction.mockResolvedValue(result);
      renderCard(EMAIL_NONE);
      fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
      fireEvent.change(keyInput(), { target: { value: KEY } });
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(fromInput()).toHaveValue("orders@shop.example");
      expect(keyInput()).toHaveValue(KEY);
      expect(chip()).toHaveTextContent(copy.statusNotConnected);
    },
  );

  it("puts the server's field issues under the fields", async () => {
    actions.saveEmailConnectionAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { fromEmail: copy.fromInvalid, apiKey: copy.keyInvalid },
    });
    renderCard(EMAIL_NONE);
    fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByText(copy.keyInvalid)).toBeInTheDocument();
    expect(screen.getByText(copy.fromInvalid)).toBeInTheDocument();
    expect(keyInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("says so when the call itself crashes", async () => {
    actions.saveEmailConnectionAction.mockRejectedValue(new Error("network"));
    renderCard(EMAIL_NONE);
    fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
    fireEvent.change(keyInput(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
  });

  it("warns that a Gmail address can't send through Resend", () => {
    renderCard(EMAIL_NONE);

    fireEvent.change(fromInput(), { target: { value: "me@gmail.com" } });
    expect(screen.getByText(copy.freeMail)).toBeInTheDocument();
    fireEvent.change(fromInput(), { target: { value: "me@shop.example" } });
    expect(screen.queryByText(copy.freeMail)).toBeNull();
  });
});

describe("Email account card: connected", () => {
  it("never prefills the key, says which key is stored, and shows the From in <bdi dir=auto>", () => {
    renderCard(EMAIL_CONNECTED);

    expect(chip()).toHaveTextContent(copy.statusConnected);
    expect(keyInput()).toHaveValue("");
    expect(
      screen.getByText("Key ending in 1234. Leave this empty to keep it."),
    ).toBeInTheDocument();
    expect(fromInput()).toHaveValue("orders@shop.example");
    const sending = screen.getByText(/Customer emails go out from/);
    const email = within(sending).getByText("orders@shop.example");
    expect(email.tagName).toBe("BDI");
    expect(email).toHaveAttribute("dir", "auto");
    expect(screen.queryByTestId("email-last-error")).toBeNull();
  });

  it("keeps the stored key when the box is empty and sends the loaded version", async () => {
    actions.saveEmailConnectionAction.mockResolvedValue(success(EMAIL_CONNECTED));
    renderCard(EMAIL_CONNECTED);

    fireEvent.change(fromInput(), { target: { value: " Sales@Shop.Example " } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    await screen.findByRole("status");
    expect(actions.saveEmailConnectionAction).toHaveBeenCalledWith({
      kind: "resend",
      fromEmail: "sales@shop.example",
      apiKey: null,
      expectedVersion: 2,
    });
  });

  it("replaces the key when a new one is typed", async () => {
    actions.saveEmailConnectionAction.mockResolvedValue(success(EMAIL_CONNECTED));
    renderCard(EMAIL_CONNECTED);

    fireEvent.change(keyInput(), { target: { value: ` ${KEY} ` } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    await screen.findByRole("status");
    expect(actions.saveEmailConnectionAction).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: KEY, expectedVersion: 2 }),
    );
  });

  it("sends a test and shows it was sent", async () => {
    actions.testEmailConnectionAction.mockResolvedValue(success(EMAIL_CONNECTED));
    renderCard(EMAIL_CONNECTED);

    fireEvent.click(screen.getByRole("button", { name: copy.sendTest }));

    expect(await screen.findByRole("status")).toHaveTextContent(copy.testSent);
    expect(actions.testEmailConnectionAction).toHaveBeenCalledTimes(1);
  });

  it("shows a test that was refused as Failed, with the provider's message", async () => {
    actions.testEmailConnectionAction.mockResolvedValue(success(EMAIL_FAILED));
    renderCard(EMAIL_CONNECTED);

    fireEvent.click(screen.getByRole("button", { name: copy.sendTest }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.testFailed);
    expect(chip()).toHaveTextContent(copy.statusFailed);
    expect(screen.getByTestId("email-last-error")).toHaveTextContent(
      "The domain shop.example is not verified in Resend",
    );
  });

  it("switches customer email off with the loaded version", async () => {
    actions.setEmailConnectionEnabledAction.mockResolvedValue(success(EMAIL_OFF));
    renderCard(EMAIL_CONNECTED);

    const toggle = screen.getByRole("switch", { name: copy.enabledLabel });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(actions.setEmailConnectionEnabledAction).toHaveBeenCalledWith({
      enabled: false,
      expectedVersion: 2,
    });
    expect(chip()).toHaveTextContent(copy.statusOff);
  });

  it("shows the conflict message and leaves the switch where it was", async () => {
    actions.setEmailConnectionEnabledAction.mockResolvedValue({
      status: "conflict",
      message: en.notificationSettings.conflict,
    });
    renderCard(EMAIL_CONNECTED);

    const toggle = screen.getByRole("switch", { name: copy.enabledLabel });
    fireEvent.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent(en.notificationSettings.conflict);
    expect(toggle).toBeChecked();
  });

  it("replaces the form with a newer version from the server", () => {
    const { rerender } = render(
      <EmailAccountCard email={EMAIL_CONNECTED} onChange={() => undefined} t={en} />,
    );
    fireEvent.change(keyInput(), { target: { value: KEY } });

    rerender(
      <EmailAccountCard
        email={{
          ...EMAIL_CONNECTED,
          connection: { ...CONNECTION, fromEmail: "new@shop.example", version: 5 },
        }}
        onChange={() => undefined}
        t={en}
      />,
    );

    expect(fromInput()).toHaveValue("new@shop.example");
    expect(keyInput()).toHaveValue("");
  });
});

describe("Email account card: failed and switched off", () => {
  it("shows the failed chip and the last error as the server sent it", () => {
    renderCard(EMAIL_FAILED);

    expect(chip()).toHaveTextContent(copy.statusFailed);
    expect(screen.getByTestId("email-last-error")).toHaveTextContent(
      "Last error: The domain shop.example is not verified in Resend",
    );
  });

  it("shows an error text that is plain text, never markup", () => {
    renderCard({
      ...EMAIL_FAILED,
      connection: { ...EMAIL_FAILED.connection!, lastError: "<img src=x onerror=alert(1)>" },
    });

    expect(screen.getByTestId("email-last-error").querySelector("img")).toBeNull();
    expect(screen.getByTestId("email-last-error")).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("shows 'Switched off' and turns it back on with the loaded version", async () => {
    actions.setEmailConnectionEnabledAction.mockResolvedValue(success(EMAIL_CONNECTED));
    renderCard(EMAIL_OFF);

    expect(chip()).toHaveTextContent(copy.statusOff);
    const toggle = screen.getByRole("switch", { name: copy.enabledLabel });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() => expect(chip()).toHaveTextContent(copy.statusConnected));
    expect(actions.setEmailConnectionEnabledAction).toHaveBeenCalledWith({
      enabled: true,
      expectedVersion: 3,
    });
  });
});

describe("Email account card: not available and unreadable", () => {
  it("says 'Not available yet' and offers no form when the server cannot store keys", () => {
    renderCard(EMAIL_UNAVAILABLE);

    expect(screen.getByRole("note")).toHaveTextContent(copy.notAvailable);
    expect(chip()).toHaveTextContent(copy.statusNotConnected);
    expect(screen.queryByLabelText(copy.keyLabel)).toBeNull();
    expect(screen.queryByRole("button", { name: copy.save })).toBeNull();
  });

  it("says it could not load, rather than guessing 'not connected'", () => {
    renderCard(null);

    expect(screen.getByText(copy.loadError)).toBeInTheDocument();
    expect(screen.queryByTestId("email-status")).toBeNull();
    expect(screen.queryByLabelText(copy.keyLabel)).toBeNull();
  });
});

describe("Disconnect dialog", () => {
  const open = async () => {
    renderCard(EMAIL_CONNECTED);
    const trigger = screen.getByRole("button", { name: copy.disconnect });
    fireEvent.click(trigger);
    const dialog = await body().findByRole("dialog", { name: copy.disconnectTitle });
    return { trigger, dialog };
  };

  it("opens a dialog with a title and a description, focus on Cancel", async () => {
    const { dialog } = await open();

    expect(dialog).toHaveAccessibleDescription(copy.disconnectBody);
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: copy.disconnectCancel })).toHaveFocus(),
    );
    expect(within(dialog).getByRole("button", { name: copy.disconnectConfirm })).not.toHaveFocus();
  });

  it("Escape closes it, focus returns to the trigger and nothing is disconnected", async () => {
    const { trigger, dialog } = await open();

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.disconnectEmailConnectionAction).not.toHaveBeenCalled();
  });

  it("Cancel closes it and focus returns to the trigger", async () => {
    const { trigger, dialog } = await open();

    fireEvent.click(within(dialog).getByRole("button", { name: copy.disconnectCancel }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("disconnecting shows Not connected, says so, and moves focus to the form", async () => {
    actions.disconnectEmailConnectionAction.mockResolvedValue(success(EMAIL_NONE));
    const { dialog } = await open();

    fireEvent.click(within(dialog).getByRole("button", { name: copy.disconnectConfirm }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(chip()).toHaveTextContent(copy.statusNotConnected);
    expect(await screen.findByRole("status")).toHaveTextContent(copy.disconnected);
    expect(screen.queryByRole("switch")).toBeNull();
    await waitFor(() => expect(fromInput()).toHaveFocus());
    expect(fromInput()).toHaveValue("");
  });

  it("Escape closes it even while the request is pending, and the result still lands", async () => {
    let finish: (result: EmailConnectionActionResult) => void = () => undefined;
    actions.disconnectEmailConnectionAction.mockReturnValue(
      new Promise<EmailConnectionActionResult>((resolve) => {
        finish = resolve;
      }),
    );
    const { dialog } = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.disconnectConfirm }));
    expect(await within(dialog).findByRole("button", { name: copy.disconnecting })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: copy.disconnectCancel })).toBeDisabled();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());

    finish(success(EMAIL_NONE));
    await waitFor(() => expect(chip()).toHaveTextContent(copy.statusNotConnected));
  });

  it("shows a refusal inside the open dialog, which stays open", async () => {
    actions.disconnectEmailConnectionAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    const { dialog } = await open();

    fireEvent.click(within(dialog).getByRole("button", { name: copy.disconnectConfirm }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(en.formErrors.forbidden);
    expect(body().getByRole("dialog", { name: copy.disconnectTitle })).toBeInTheDocument();
    expect(chip()).toHaveTextContent(copy.statusConnected);
  });

  it("shows a refusal that arrives after the dialog was closed on the card", async () => {
    let finish: (result: EmailConnectionActionResult) => void = () => undefined;
    actions.disconnectEmailConnectionAction.mockReturnValue(
      new Promise<EmailConnectionActionResult>((resolve) => {
        finish = resolve;
      }),
    );
    const { dialog } = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.disconnectConfirm }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());

    finish({ status: "unavailable" });

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.unavailable);
    expect(chip()).toHaveTextContent(copy.statusConnected);
  });
});

describe("Email account card: Arabic and logical CSS", () => {
  it("renders every section in Arabic with logical classes only", async () => {
    const arCopy = ar.notificationSettings.email;
    const { container } = renderCard(EMAIL_FAILED, ar);

    expect(screen.getByText(arCopy.title)).toBeInTheDocument();
    expect(chip()).toHaveTextContent(arCopy.statusFailed);
    expect(screen.getByLabelText(arCopy.fromLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(arCopy.keyLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: arCopy.save })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: arCopy.sendTest })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: arCopy.enabledLabel })).toBeInTheDocument();
    expect(screen.getByText(arCopy.howTo3)).toBeInTheDocument();
    expect(screen.getAllByText(arCopy.comingSoon)).toHaveLength(2);
    expect(screen.queryByText(copy.title)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: arCopy.disconnect }));
    expect(await body().findByRole("dialog", { name: arCopy.disconnectTitle })).toBeVisible();

    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
  });
});

describe("Email account card: sending limits and the provider list", () => {
  it("shows the muted sending-limits note under the provider choice, in this order", () => {
    renderCard(EMAIL_NONE);

    const note = screen.getByTestId("email-limits");
    expect(note).toHaveClass("text-muted-foreground");
    expect(within(note).getByRole("heading", { name: copy.limitsTitle })).toBeInTheDocument();
    expect(
      within(note)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([copy.limitsResend, copy.limitsGmail]);
    expect(note).toHaveTextContent(copy.limitsClosing);

    const providers = screen.getByRole("group", { name: copy.providerLabel });
    expect(providers.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("states the numbers as the owner gave them", () => {
    renderCard(EMAIL_NONE);

    const note = screen.getByTestId("email-limits");
    expect(note).toHaveTextContent(
      "Resend free plan: up to 100 emails a day (3,000 a month). Resend Pro: 50,000 a month with no daily cap.",
    );
    expect(note).toHaveTextContent(
      "Gmail (personal): about 500 emails a day. Reaching it also pauses your own Gmail for up to 24 hours. Google Workspace: 2,000 a day.",
    );
    expect(note).toHaveTextContent(
      "Each order sends about 2–3 emails. Limits are set by the email provider and can change.",
    );
  });

  it("is shown for a connected account too, and not when the server cannot store keys", () => {
    const { unmount } = renderCard(EMAIL_CONNECTED);
    expect(screen.getByTestId("email-limits")).toBeInTheDocument();
    unmount();

    renderCard(EMAIL_UNAVAILABLE);
    expect(screen.queryByTestId("email-limits")).toBeNull();
  });

  it("shows the note in Arabic", () => {
    const arCopy = ar.notificationSettings.email;
    renderCard(EMAIL_NONE, ar);

    const note = screen.getByTestId("email-limits");
    expect(within(note).getByRole("heading", { name: arCopy.limitsTitle })).toBeInTheDocument();
    expect(note).toHaveTextContent(arCopy.limitsResend);
    expect(note).toHaveTextContent(arCopy.limitsGmail);
    expect(note).toHaveTextContent(arCopy.limitsClosing);
    expect(arCopy.limitsClosing).not.toBe(copy.limitsClosing);
  });

  it("builds the provider list from the model: a data row with no kind is a disabled 'Coming soon'", () => {
    renderCard(EMAIL_NONE);

    const group = screen.getByRole("group", { name: copy.providerLabel });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(EMAIL_PROVIDER_CHOICES.length);
    for (const choice of EMAIL_PROVIDER_CHOICES) {
      const radio = radios.find((node) => node.getAttribute("value") === choice.id);
      expect(radio, choice.id).toBeDefined();
      if (choice.kind === null) expect(radio).toBeDisabled();
      else if (choice.needsSmtp) expect(radio).toBeDisabled();
      else expect(radio).toBeChecked();
    }
    expect(within(group).getAllByText(copy.comingSoon)).toHaveLength(
      EMAIL_PROVIDER_CHOICES.filter((choice) => choice.kind === null).length,
    );
  });

  it("only lists a selectable provider the server can connect", () => {
    for (const choice of EMAIL_PROVIDER_CHOICES) {
      if (choice.kind !== null) expect(EMAIL_CONNECTION_KINDS).toContain(choice.kind);
    }
    expect(new Set(EMAIL_PROVIDER_CHOICES.map((choice) => choice.id)).size).toBe(
      EMAIL_PROVIDER_CHOICES.length,
    );
  });
});

describe("Email account card: mailbox (SMTP) accounts", () => {
  const PASSWORD = "abcd efgh ijkl mnop";
  const providers = () => screen.getByRole("group", { name: copy.providerLabel });
  const mailboxRadio = () =>
    within(providers()).getByRole("radio", { name: /Gmail \/ other mailbox/ });
  const usernameInput = () => screen.getByLabelText(copy.usernameLabel);
  const passwordInput = () => screen.getByLabelText(copy.passwordLabel);

  function chooseMailbox() {
    fireEvent.click(mailboxRadio());
  }

  describe("the server's SMTP switch is off", () => {
    it("disables the option with 'Needs a server upgrade' and shows no mailbox form", () => {
      renderCard(EMAIL_NONE);

      expect(mailboxRadio()).toBeDisabled();
      expect(within(providers()).getByText(copy.needsUpgrade)).toBeInTheDocument();
      expect(screen.queryByLabelText(copy.passwordLabel)).toBeNull();
      expect(screen.queryByTestId("email-needs-upgrade")).toBeNull();
      // Resend keeps working and stays selected.
      expect(within(providers()).getByRole("radio", { name: "Resend" })).toBeChecked();
    });

    it("a mailbox that was connected before keeps its page, locked, with Disconnect still there", () => {
      renderCard(EMAIL_SMTP_FLAG_OFF);

      expect(mailboxRadio()).toBeChecked();
      expect(screen.getByTestId("email-needs-upgrade")).toHaveTextContent(copy.needsUpgrade);
      expect(screen.getByTestId("email-needs-upgrade")).toHaveTextContent(copy.needsUpgradeBody);
      expect(screen.getByRole("button", { name: copy.save })).toBeDisabled();
      expect(usernameInput()).toBeDisabled();
      expect(passwordInput()).toBeDisabled();
      expect(screen.getByRole("button", { name: copy.sendTest })).toBeDisabled();
      expect(screen.getByRole("switch", { name: copy.enabledLabel })).toBeDisabled();
      expect(screen.getByRole("button", { name: copy.disconnect })).toBeEnabled();
    });

    it("says it in Arabic too", () => {
      const arCopy = ar.notificationSettings.email;
      renderCard(EMAIL_SMTP_FLAG_OFF, ar);
      expect(screen.getByTestId("email-needs-upgrade")).toHaveTextContent(arCopy.needsUpgrade);
      expect(arCopy.needsUpgrade).not.toBe(copy.needsUpgrade);
    });
  });

  describe("choosing the mailbox", () => {
    it("is a real selection: the Resend key box gives way to the mailbox form, and back", () => {
      renderCard(EMAIL_NONE_SMTP);

      expect(screen.getByLabelText(copy.keyLabel)).toBeInTheDocument();
      expect(screen.queryByLabelText(copy.passwordLabel)).toBeNull();

      chooseMailbox();
      expect(mailboxRadio()).toBeChecked();
      expect(within(providers()).getByRole("radio", { name: "Resend" })).not.toBeChecked();
      expect(screen.queryByLabelText(copy.keyLabel)).toBeNull();
      expect(screen.getByLabelText(copy.presetLabel)).toHaveValue("gmail");
      expect(usernameInput()).toHaveValue("");
      expect(passwordInput()).toHaveAttribute("type", "password");
      expect(passwordInput()).toHaveValue("");
      // Host, port and security are for "other mail server" only.
      expect(screen.queryByLabelText(copy.hostLabel)).toBeNull();
      expect(screen.queryByLabelText(copy.portLabel)).toBeNull();
      expect(screen.queryByLabelText(copy.securityLabel)).toBeNull();

      fireEvent.click(within(providers()).getByRole("radio", { name: "Resend" }));
      expect(screen.getByLabelText(copy.keyLabel)).toBeInTheDocument();
      expect(screen.queryByLabelText(copy.passwordLabel)).toBeNull();
    });

    it("shows the Gmail app-password how-to with its two links", () => {
      renderCard(EMAIL_NONE_SMTP);
      chooseMailbox();

      const steps = within(screen.getByRole("region", { name: copy.gmailHowToTitle })).getAllByRole(
        "listitem",
      );
      expect(steps.map((step) => step.textContent?.replace(/\s+/g, " ").trim())).toEqual([
        `${copy.gmailHowTo1} ${copy.gmailLink1}`,
        `${copy.gmailHowTo2} ${copy.gmailLink2}`,
        copy.gmailHowTo3,
        copy.gmailHowTo4,
      ]);
      expect(copy.gmailHowTo1).toMatch(/2-Step Verification/);
      expect(copy.gmailHowTo2).toMatch(/App passwords/);
      expect(copy.gmailHowTo3).toMatch(/16 characters/);
      const link = screen.getByRole("link", { name: copy.gmailLink2 });
      expect(link).toHaveAttribute("href", "https://myaccount.google.com/apppasswords");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(screen.queryByRole("region", { name: copy.howToTitle })).toBeNull();
    });

    it("lists the presets and swaps the how-to for each", () => {
      renderCard(EMAIL_NONE_SMTP);
      chooseMailbox();
      const picker = screen.getByLabelText(copy.presetLabel);
      expect(
        within(picker)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Gmail", "Outlook / Hotmail", "Zoho Mail", copy.presetCustom]);

      fireEvent.change(picker, { target: { value: "outlook" } });
      expect(screen.getByTestId("email-mailbox-note")).toHaveTextContent(copy.outlookNote);
      expect(screen.queryByRole("region", { name: copy.gmailHowToTitle })).toBeNull();
      fireEvent.change(picker, { target: { value: "zoho" } });
      expect(screen.getByTestId("email-mailbox-note")).toHaveTextContent(copy.zohoNote);
      fireEvent.change(picker, { target: { value: "custom" } });
      expect(screen.getByTestId("email-mailbox-note")).toHaveTextContent(copy.customNote);
    });

    it("asks for host, port and security only for 'other mail server'", () => {
      renderCard(EMAIL_NONE_SMTP);
      chooseMailbox();
      fireEvent.change(screen.getByLabelText(copy.presetLabel), { target: { value: "custom" } });

      expect(screen.getByLabelText(copy.hostLabel)).toHaveValue("");
      expect(screen.getByLabelText(copy.portLabel)).toHaveValue(465);
      expect(screen.getByLabelText(copy.securityLabel)).toHaveValue("tls");
      expect(screen.getByLabelText(copy.hostLabel)).toHaveAttribute("dir", "ltr");

      fireEvent.change(screen.getByLabelText(copy.presetLabel), { target: { value: "zoho" } });
      expect(screen.queryByLabelText(copy.hostLabel)).toBeNull();
    });
  });

  describe("saving a mailbox", () => {
    function fillGmail() {
      chooseMailbox();
      fireEvent.change(fromInput(), { target: { value: "Shop@Gmail.com" } });
      fireEvent.change(usernameInput(), { target: { value: "shop@gmail.com" } });
      fireEvent.change(passwordInput(), { target: { value: PASSWORD } });
    }

    it("sends the preset, the username and the app password; then says 'Password saved', never the password", async () => {
      actions.saveEmailConnectionAction.mockResolvedValue(success(EMAIL_SMTP_CONNECTED));
      renderCard(EMAIL_NONE_SMTP);
      fillGmail();
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(await screen.findByRole("status")).toHaveTextContent(copy.savedConnected);
      expect(actions.saveEmailConnectionAction).toHaveBeenCalledWith({
        kind: "smtp",
        fromEmail: "shop@gmail.com",
        smtp: { preset: "gmail", username: "shop@gmail.com" },
        password: PASSWORD,
        expectedVersion: null,
      });
      expect(chip()).toHaveTextContent(copy.statusConnected);
      expect(passwordInput()).toHaveValue("");
      expect(screen.getByText(copy.passwordSaved)).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("abcd efgh");
      expect(screen.queryByText(/ending in/)).toBeNull();
    });

    it("sends a custom server's details with the password", async () => {
      actions.saveEmailConnectionAction.mockResolvedValue(success(EMAIL_SMTP_CONNECTED));
      renderCard(EMAIL_NONE_SMTP);
      chooseMailbox();
      fireEvent.change(screen.getByLabelText(copy.presetLabel), { target: { value: "custom" } });
      fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
      fireEvent.change(screen.getByLabelText(copy.hostLabel), {
        target: { value: "mail.shop.example" },
      });
      fireEvent.change(screen.getByLabelText(copy.portLabel), { target: { value: "587" } });
      fireEvent.change(screen.getByLabelText(copy.securityLabel), {
        target: { value: "starttls" },
      });
      fireEvent.change(usernameInput(), { target: { value: "mailer" } });
      fireEvent.change(passwordInput(), { target: { value: "s3cret-pass" } });
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      await waitFor(() => expect(actions.saveEmailConnectionAction).toHaveBeenCalledTimes(1));
      expect(actions.saveEmailConnectionAction).toHaveBeenCalledWith({
        kind: "smtp",
        fromEmail: "orders@shop.example",
        smtp: {
          preset: "custom",
          username: "mailer",
          host: "mail.shop.example",
          port: 587,
          security: "starttls",
        },
        password: "s3cret-pass",
        expectedVersion: null,
      });
    });

    it("refuses missing pieces without calling the server", () => {
      renderCard(EMAIL_NONE_SMTP);
      chooseMailbox();
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(screen.getByText(copy.fromInvalid)).toBeInTheDocument();
      expect(screen.getByText(copy.usernameRequired)).toBeInTheDocument();
      expect(screen.getByText(copy.passwordRequired)).toBeInTheDocument();
      expect(actions.saveEmailConnectionAction).not.toHaveBeenCalled();
    });

    it("a Gmail preset needs the From address to be the mailbox itself", () => {
      renderCard(EMAIL_NONE_SMTP);
      chooseMailbox();
      fireEvent.change(fromInput(), { target: { value: "orders@gmail.com" } });
      fireEvent.change(usernameInput(), { target: { value: "shop@gmail.com" } });
      fireEvent.change(passwordInput(), { target: { value: PASSWORD } });
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(screen.getByText(copy.fromMustMatch)).toBeInTheDocument();
      expect(actions.saveEmailConnectionAction).not.toHaveBeenCalled();
    });

    it("a custom server needs a name and one of the mail ports", () => {
      renderCard(EMAIL_NONE_SMTP);
      chooseMailbox();
      fireEvent.change(screen.getByLabelText(copy.presetLabel), { target: { value: "custom" } });
      fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
      fireEvent.change(usernameInput(), { target: { value: "mailer" } });
      fireEvent.change(passwordInput(), { target: { value: "x" } });
      fireEvent.change(screen.getByLabelText(copy.portLabel), { target: { value: "22" } });
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(screen.getByText(copy.hostRequired)).toBeInTheDocument();
      expect(screen.getByText(copy.portInvalid)).toBeInTheDocument();
      expect(actions.saveEmailConnectionAction).not.toHaveBeenCalled();
    });

    it("puts the server's field issues for a mailbox under the right fields", async () => {
      actions.saveEmailConnectionAction.mockResolvedValue({
        status: "error",
        message: en.formErrors.invalid,
        fieldErrors: { "smtp.host": copy.hostInvalid, password: copy.passwordInvalid },
      });
      renderCard(EMAIL_NONE_SMTP);
      chooseMailbox();
      fireEvent.change(screen.getByLabelText(copy.presetLabel), { target: { value: "custom" } });
      fireEvent.change(fromInput(), { target: { value: "orders@shop.example" } });
      fireEvent.change(screen.getByLabelText(copy.hostLabel), {
        target: { value: "x.shop.example" },
      });
      fireEvent.change(usernameInput(), { target: { value: "mailer" } });
      fireEvent.change(passwordInput(), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(await screen.findByText(copy.hostInvalid)).toBeInTheDocument();
      expect(screen.getByText(copy.passwordInvalid)).toBeInTheDocument();
    });

    it("shows the mailbox's refusal as Failed with the page's own sentence, not the server's", async () => {
      actions.saveEmailConnectionAction.mockResolvedValue(success(EMAIL_SMTP_FAILED));
      renderCard(EMAIL_NONE_SMTP);
      fillGmail();
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(await screen.findByRole("alert")).toHaveTextContent(copy.savedFailed);
      expect(chip()).toHaveTextContent(copy.statusFailed);
      expect(screen.getByTestId("email-last-error")).toHaveTextContent(copy.smtpErrors.AUTH_FAILED);
      expect(screen.getByTestId("email-last-error")).not.toHaveTextContent("AUTH_FAILED:");
    });
  });

  describe("a connected mailbox", () => {
    it("shows the mailbox, 'Password saved' (no last four), and never prefills the password", () => {
      renderCard(EMAIL_SMTP_CONNECTED);

      expect(chip()).toHaveTextContent(copy.statusConnected);
      expect(mailboxRadio()).toBeChecked();
      expect(screen.getByLabelText(copy.presetLabel)).toHaveValue("gmail");
      expect(usernameInput()).toHaveValue("shop@gmail.com");
      expect(passwordInput()).toHaveValue("");
      expect(screen.getByText(copy.passwordSaved)).toBeInTheDocument();
      expect(screen.queryByText(/ending in/)).toBeNull();
      expect(screen.getByText(/Customer emails go out from/)).toHaveTextContent("shop@gmail.com");
    });

    it("keeps the saved password when the box is empty and sends the loaded version", async () => {
      actions.saveEmailConnectionAction.mockResolvedValue(success(EMAIL_SMTP_CONNECTED));
      renderCard(EMAIL_SMTP_CONNECTED);
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      await waitFor(() => expect(actions.saveEmailConnectionAction).toHaveBeenCalledTimes(1));
      expect(actions.saveEmailConnectionAction).toHaveBeenCalledWith({
        kind: "smtp",
        fromEmail: "shop@gmail.com",
        smtp: { preset: "gmail", username: "shop@gmail.com" },
        password: null,
        expectedVersion: 4,
      });
    });

    it("a saved mailbox that is switched to Resend must bring a Resend key", () => {
      renderCard({ ...EMAIL_SMTP_CONNECTED, smtpAvailable: true });
      fireEvent.click(within(providers()).getByRole("radio", { name: "Resend" }));
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(screen.getByText(copy.keyRequired)).toBeInTheDocument();
      expect(actions.saveEmailConnectionAction).not.toHaveBeenCalled();
    });

    it("a Resend account switched to a mailbox must bring a password", () => {
      renderCard({ ...EMAIL_CONNECTED, smtpAvailable: true });
      chooseMailbox();
      fireEvent.change(usernameInput(), { target: { value: "shop@gmail.com" } });
      fireEvent.change(fromInput(), { target: { value: "shop@gmail.com" } });
      fireEvent.click(screen.getByRole("button", { name: copy.save }));

      expect(screen.getByText(copy.passwordRequired)).toBeInTheDocument();
      expect(actions.saveEmailConnectionAction).not.toHaveBeenCalled();
    });
  });

  describe("every failure code has a sentence in both languages", () => {
    const codes = [
      "AUTH_FAILED",
      "DAILY_LIMIT",
      "CONNECTION_FAILED",
      "TLS_FAILED",
      "REJECTED",
    ] as const;

    it.each(codes)("%s is worded by the page, in English and Arabic", (code) => {
      const snapshot: EmailConnectionSnapshot = {
        ...EMAIL_SMTP_FAILED,
        connection: {
          ...EMAIL_SMTP_FAILED.connection!,
          lastError: `${code}: server words that must not be shown`,
          lastErrorCode: code,
        },
      };
      const { unmount } = renderCard(snapshot);
      expect(screen.getByTestId("email-last-error")).toHaveTextContent(copy.smtpErrors[code]);
      expect(screen.getByTestId("email-last-error")).not.toHaveTextContent("server words");
      unmount();

      const arCopy = ar.notificationSettings.email;
      renderCard(snapshot, ar);
      expect(screen.getByTestId("email-last-error")).toHaveTextContent(arCopy.smtpErrors[code]);
      expect(arCopy.smtpErrors[code]).not.toBe(copy.smtpErrors[code]);
    });

    it("CONNECTION_FAILED says the server may block mail ports", () => {
      expect(copy.smtpErrors.CONNECTION_FAILED).toMatch(/may block mail ports/);
      expect(copy.smtpErrors.AUTH_FAILED).toMatch(/app password/);
    });
  });

  describe("Arabic and logical CSS", () => {
    it("renders the mailbox form in Arabic with logical classes only", () => {
      const arCopy = ar.notificationSettings.email;
      const { container } = renderCard(EMAIL_SMTP_CONNECTED, ar);

      expect(screen.getByLabelText(arCopy.presetLabel)).toBeInTheDocument();
      expect(screen.getByLabelText(arCopy.usernameLabel)).toBeInTheDocument();
      expect(screen.getByLabelText(arCopy.passwordLabel)).toBeInTheDocument();
      expect(screen.getByText(arCopy.passwordSaved)).toBeInTheDocument();
      expect(screen.getByRole("region", { name: arCopy.gmailHowToTitle })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(arCopy.presetLabel), { target: { value: "custom" } });
      expect(screen.getByLabelText(arCopy.hostLabel)).toBeInTheDocument();
      expect(screen.getByLabelText(arCopy.securityLabel)).toBeInTheDocument();

      const classes = Array.from(container.querySelectorAll("[class]"))
        .map((element) => element.getAttribute("class") ?? "")
        .join(" ")
        .split(/\s+/);
      expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
    });

    it("has an Arabic string for every mailbox string", () => {
      const keys = Object.keys(copy) as (keyof typeof copy)[];
      const arCopy = ar.notificationSettings.email;
      expect(Object.keys(arCopy).sort()).toEqual(keys.sort());
      expect(Object.keys(arCopy.smtpErrors).sort()).toEqual(Object.keys(copy.smtpErrors).sort());
    });
  });
});
