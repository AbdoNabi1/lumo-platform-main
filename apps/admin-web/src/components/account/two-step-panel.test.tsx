import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnTwoStepStatus } from "@/lib/staff/two-step";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({
  startTwoStepAction: vi.fn(),
  confirmTwoStepAction: vi.fn(),
  regenerateBackupCodesAction: vi.fn(),
  disableTwoStepAction: vi.fn(),
}));
vi.mock("@/app/account/security/actions", () => actions);

const { TwoStepPanel } = await import("./two-step-panel");

const body = () => within(document.body);
const KEY = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const GROUPED = "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP";
const URI = `otpauth://totp/Morbeh:me%40shop.example?secret=${KEY}&issuer=Morbeh`;
const SETUP = {
  enrollmentId: "5b8d3f1e-0000-4000-8000-000000000001",
  manualKey: KEY,
  provisioningUri: URI,
};
const CODES = [
  "aaaa-1111-0001",
  "aaaa-1111-0002",
  "aaaa-1111-0003",
  "aaaa-1111-0004",
  "aaaa-1111-0005",
  "aaaa-1111-0006",
  "aaaa-1111-0007",
  "aaaa-1111-0008",
  "aaaa-1111-0009",
  "aaaa-1111-0010",
];
const NEW_CODES = CODES.map((code) => code.replace("aaaa", "bbbb"));

const OFF: OwnTwoStepStatus = {
  enabled: false,
  activatedAt: null,
  backupCodesLeft: 0,
  policyRequired: false,
};
const ON: OwnTwoStepStatus = {
  enabled: true,
  activatedAt: "2026-11-20T10:00:00.000Z",
  backupCodesLeft: 9,
  policyRequired: false,
};

function mount(status: OwnTwoStepStatus, t: Dictionary = en, locale: "en" | "ar" = "en") {
  const view = render(<TwoStepPanel status={status} t={t} locale={locale} />);
  return {
    ...view,
    update: (next: OwnTwoStepStatus) =>
      view.rerender(<TwoStepPanel status={next} t={t} locale={locale} />),
  };
}

function hold() {
  let settle!: (value: unknown) => void;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, settle: (value: unknown) => settle(value) };
}

const ok = <T,>(data: T) => ({ status: "ok", data }) as const;
const refusal = (reason: string, message: string) =>
  ({ status: "error", reason, message }) as const;
const escape = (element: HTMLElement) => fireEvent.keyDown(element, { key: "Escape" });

async function startSetup(t: Dictionary = en) {
  actions.startTwoStepAction.mockResolvedValue(ok(SETUP));
  fireEvent.click(screen.getByRole("button", { name: t.accountSecurity.turnOn }));
  return await screen.findByLabelText(t.accountSecurity.setup.codeLabel);
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  for (const mock of Object.values(actions)) mock.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("turning two-step on", () => {
  it("off: explains it and offers Turn on", () => {
    mount(OFF);
    expect(screen.getByText(en.accountSecurity.statusOff)).toBeInTheDocument();
    expect(screen.getByText(en.accountSecurity.offBody)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOn })).toBeEnabled();
    expect(screen.queryByRole("button", { name: en.accountSecurity.turnOff })).toBeNull();
  });

  it("start shows the manual key in blocks of four with Copy, the otpauth link, and a code input", async () => {
    mount(OFF);
    const input = await startSetup();

    expect(screen.getByText(GROUPED)).toHaveAttribute("dir", "ltr");
    const link = screen.getByRole("link", { name: en.accountSecurity.setup.openInApp });
    expect(link).toHaveAttribute("href", URI);
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(screen.getByRole("button", { name: en.accountSecurity.setup.confirm })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.copy }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(KEY));
    expect(
      await screen.findByRole("button", { name: en.accountSecurity.setup.copied }),
    ).toBeInTheDocument();
  });

  it("confirm sends the enrolment and the code, then shows the 10 backup codes once", async () => {
    mount(OFF);
    const input = await startSetup();
    actions.confirmTwoStepAction.mockResolvedValue(ok({ backupCodes: CODES }));
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.confirm }));

    const list = await screen.findByRole("list", { name: en.accountSecurity.codes.listLabel });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(actions.confirmTwoStepAction).toHaveBeenCalledWith({
      enrollmentId: SETUP.enrollmentId,
      code: "123456",
    });
    // The secret and the link are gone the moment the codes appear.
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain("otpauth://");
    // Focus moves in a passive effect: under a loaded run it lands a tick after the list appears.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: en.accountSecurity.codes.title })).toHaveFocus(),
    );
  });

  it('Done stays disabled until "I saved my backup codes" is checked; then the codes and the secret are gone', async () => {
    mount(OFF);
    const input = await startSetup();
    actions.confirmTwoStepAction.mockResolvedValue(ok({ backupCodes: CODES }));
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.confirm }));
    await screen.findByRole("list", { name: en.accountSecurity.codes.listLabel });

    const done = screen.getByRole("button", { name: en.accountSecurity.codes.done });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: en.accountSecurity.codes.savedLabel }));
    expect(done).toBeEnabled();
    fireEvent.click(done);

    expect(screen.queryByRole("list", { name: en.accountSecurity.codes.listLabel })).toBeNull();
    // Non-disclosure on the whole document: no secret, no link, no backup code survives Done.
    const html = document.body.innerHTML;
    expect(html).not.toContain(KEY);
    expect(html).not.toContain(GROUPED);
    expect(html).not.toContain("otpauth://");
    expect(html).not.toContain("aaaa-1111");
    expect(screen.getByText(en.accountSecurity.statusOn)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(en.accountSecurity.notices.enabled);
    expect(
      screen.getByText(en.accountSecurity.codesLeft.replace("{count}", "10")),
    ).toBeInTheDocument();
  });

  it("Copy all and Download .txt hand the codes out", async () => {
    mount(OFF);
    const input = await startSetup();
    actions.confirmTwoStepAction.mockResolvedValue(ok({ backupCodes: CODES }));
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.confirm }));
    await screen.findByRole("list", { name: en.accountSecurity.codes.listLabel });

    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.codes.copyAll }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODES.join("\n")),
    );

    let blob: Blob | undefined;
    const createObjectURL = vi.fn((value: Blob) => {
      blob = value;
      return "blob:codes";
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.codes.download }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:codes");
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob as Blob);
    });
    expect(text).toContain(en.accountSecurity.codes.fileHeading);
    for (const code of CODES) expect(text).toContain(code);
    click.mockRestore();
  });

  it("a wrong code shows the refusal under the input and stays in setup", async () => {
    mount(OFF);
    const input = await startSetup();
    actions.confirmTwoStepAction.mockResolvedValue(
      refusal("wrong_code", en.accountSecurity.errors.wrongCode),
    );
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.accountSecurity.errors.wrongCode);
    expect(screen.getByText(GROUPED)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: en.accountSecurity.codes.listLabel })).toBeNull();
  });

  it("an expired setup (404) goes back to the overview with the refusal", async () => {
    mount(OFF);
    const input = await startSetup();
    actions.confirmTwoStepAction.mockResolvedValue(
      refusal("expired", en.accountSecurity.errors.expired),
    );
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.accountSecurity.errors.expired);
    expect(screen.queryByText(GROUPED)).toBeNull();
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOn })).toBeEnabled();
  });

  it("Cancel throws the secret away", async () => {
    mount(OFF);
    await startSetup();
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.cancel }));
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain("otpauth://");
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOn })).toHaveFocus();
  });

  it("a server without a TOTP key says so (503 NOT_CONFIGURED) and shows no setup", async () => {
    mount(OFF);
    actions.startTwoStepAction.mockResolvedValue(
      refusal("not_configured", "Two-step verification isn't set up on this server yet."),
    );
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.turnOn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Two-step verification isn't set up on this server yet.",
    );
    expect(screen.queryByLabelText(en.accountSecurity.setup.codeLabel)).toBeNull();
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOn })).toBeEnabled();
  });

  it("while the store requires two-step an off member sees the policy note", () => {
    mount({ ...OFF, policyRequired: true });
    expect(screen.getByText(en.accountSecurity.policyOffNote)).toBeInTheDocument();
  });

  it("a confirm that lands after Cancel still shows the codes (two-step IS on)", async () => {
    mount(OFF);
    const input = await startSetup();
    const gate = hold();
    actions.confirmTwoStepAction.mockReturnValue(gate.promise);
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.confirm }));
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.setup.cancel }));
    await act(async () => gate.settle(ok({ backupCodes: CODES })));
    expect(
      await screen.findByRole("list", { name: en.accountSecurity.codes.listLabel }),
    ).toBeInTheDocument();
  });
});

describe("two-step on", () => {
  it("shows since when, the codes left, Get new backup codes and Turn off", () => {
    mount(ON);
    expect(screen.getByText(en.accountSecurity.statusOn)).toBeInTheDocument();
    expect(screen.getByText(/On since Nov 20, 2026/)).toBeInTheDocument();
    expect(
      screen.getByText(en.accountSecurity.codesLeft.replace("{count}", "9")),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.accountSecurity.newCodes })).toBeEnabled();
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOff })).toBeEnabled();
  });

  it("policy-required hides Turn off and shows the policy note", () => {
    mount({ ...ON, policyRequired: true });
    expect(screen.queryByRole("button", { name: en.accountSecurity.turnOff })).toBeNull();
    expect(screen.getByText(en.accountSecurity.policyOnNote)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.accountSecurity.newCodes })).toBeEnabled();
  });

  it("a newer server status replaces what this tab assumed", async () => {
    const view = mount(ON);
    actions.disableTwoStepAction.mockResolvedValue(ok(null));
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.turnOff }));
    fireEvent.change(await body().findByLabelText(en.accountSecurity.disable.passwordLabel), {
      target: { value: "pw" },
    });
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.disable.confirm }));
    await screen.findByText(en.accountSecurity.statusOff);
    view.update({ ...ON, backupCodesLeft: 3 });
    expect(screen.getByText(en.accountSecurity.statusOn)).toBeInTheDocument();
    expect(
      screen.getByText(en.accountSecurity.codesLeft.replace("{count}", "3")),
    ).toBeInTheDocument();
  });
});

describe("Get new backup codes", () => {
  async function openDialog() {
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.newCodes }));
    return await body().findByLabelText(en.accountSecurity.regenerate.codeLabel);
  }

  it("asks for a current code in a real dialog, then shows the new codes once", async () => {
    mount(ON);
    const input = await openDialog();
    const dialog = body().getByRole("dialog");
    expect(within(dialog).getByText(en.accountSecurity.regenerate.title)).toBeInTheDocument();
    expect(within(dialog).getByText(en.accountSecurity.regenerate.description)).toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());

    actions.regenerateBackupCodesAction.mockResolvedValue(ok({ backupCodes: NEW_CODES }));
    fireEvent.change(input, { target: { value: "654321" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.accountSecurity.regenerate.submit }),
    );

    const list = await screen.findByRole("list", { name: en.accountSecurity.codes.listLabel });
    expect(actions.regenerateBackupCodesAction).toHaveBeenCalledWith({ code: "654321" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(
      screen.getByRole("heading", { name: en.accountSecurity.codes.regeneratedTitle }),
    ).toBeInTheDocument();
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: en.accountSecurity.codes.regeneratedTitle }),
      ).toHaveFocus(),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: en.accountSecurity.codes.savedLabel }));
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.codes.done }));
    expect(document.body.innerHTML).not.toContain("bbbb-1111");
    expect(
      screen.getByText(en.accountSecurity.codesLeft.replace("{count}", "10")),
    ).toBeInTheDocument();
  });

  it("a wrong code is shown inside the dialog, which stays open", async () => {
    mount(ON);
    const input = await openDialog();
    actions.regenerateBackupCodesAction.mockResolvedValue(
      refusal("wrong_code", en.accountSecurity.errors.wrongCode),
    );
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.regenerate.submit }));
    expect(await within(body().getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      en.accountSecurity.errors.wrongCode,
    );
  });

  it("Escape while the request is pending closes the dialog; the new codes still show when it lands", async () => {
    mount(ON);
    const input = await openDialog();
    const gate = hold();
    actions.regenerateBackupCodesAction.mockReturnValue(gate.promise);
    fireEvent.change(input, { target: { value: "654321" } });
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.regenerate.submit }));
    await waitFor(() =>
      expect(
        body().getByRole("button", { name: en.accountSecurity.regenerate.submitting }),
      ).toBeDisabled(),
    );
    escape(body().getByRole("dialog"));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(actions.regenerateBackupCodesAction).toHaveBeenCalledTimes(1);

    await act(async () => gate.settle(ok({ backupCodes: NEW_CODES })));
    expect(
      await screen.findByRole("list", { name: en.accountSecurity.codes.listLabel }),
    ).toBeInTheDocument();
  });

  it("Escape without a request returns focus to the button that opened it", async () => {
    mount(ON);
    const trigger = screen.getByRole("button", { name: en.accountSecurity.newCodes });
    await openDialog();
    escape(body().getByRole("dialog"));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("Turn off", () => {
  async function openDisable() {
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.turnOff }));
    return await body().findByLabelText(en.accountSecurity.disable.passwordLabel);
  }

  it("is a real dialog with a title and description and initial focus on Cancel", async () => {
    mount(ON);
    await openDisable();
    const dialog = body().getByRole("dialog");
    expect(within(dialog).getByText(en.accountSecurity.disable.title)).toBeInTheDocument();
    expect(within(dialog).getByText(en.accountSecurity.disable.description)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: en.accountSecurity.disable.cancel }),
      ).toHaveFocus(),
    );
    expect(within(dialog).getByLabelText(en.accountSecurity.disable.passwordLabel)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("Cancel and Escape close it without a request and give focus back to Turn off", async () => {
    mount(ON);
    const trigger = screen.getByRole("button", { name: en.accountSecurity.turnOff });
    await openDisable();
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.disable.cancel }));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());

    await openDisable();
    escape(body().getByRole("dialog"));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.disableTwoStepAction).not.toHaveBeenCalled();
  });

  it("a wrong password is shown inside the dialog and the password stays editable", async () => {
    mount(ON);
    const input = await openDisable();
    actions.disableTwoStepAction.mockResolvedValue(
      refusal("wrong_password", en.accountSecurity.errors.wrongPassword),
    );
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.disable.confirm }));
    expect(await within(body().getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      en.accountSecurity.errors.wrongPassword,
    );
    expect(screen.getByText(en.accountSecurity.statusOn)).toBeInTheDocument();
  });

  it("success turns it off, clears the password and moves focus to Turn on", async () => {
    mount(ON);
    const input = await openDisable();
    actions.disableTwoStepAction.mockResolvedValue(ok(null));
    fireEvent.change(input, { target: { value: "correct horse" } });
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.disable.confirm }));
    expect(await screen.findByText(en.accountSecurity.statusOff)).toBeInTheDocument();
    expect(actions.disableTwoStepAction).toHaveBeenCalledWith({ password: "correct horse" });
    expect(screen.getByRole("status")).toHaveTextContent(en.accountSecurity.notices.disabled);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: en.accountSecurity.turnOn })).toHaveFocus(),
    );
    expect(document.body.innerHTML).not.toContain("correct horse");
  });

  it("Escape while pending closes the dialog; the answer still lands (page notice on a refusal)", async () => {
    mount(ON);
    const input = await openDisable();
    const gate = hold();
    actions.disableTwoStepAction.mockReturnValue(gate.promise);
    fireEvent.change(input, { target: { value: "pw" } });
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.disable.confirm }));
    await waitFor(() =>
      expect(
        body().getByRole("button", { name: en.accountSecurity.disable.confirming }),
      ).toBeDisabled(),
    );
    escape(body().getByRole("dialog"));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await act(async () =>
      gate.settle(refusal("wrong_password", en.accountSecurity.errors.wrongPassword)),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.accountSecurity.errors.wrongPassword,
    );
    expect(screen.getByText(en.accountSecurity.statusOn)).toBeInTheDocument();
  });

  it("a policy refusal hides Turn off at once", async () => {
    mount(ON);
    const input = await openDisable();
    actions.disableTwoStepAction.mockResolvedValue(
      refusal("policy_required", en.accountSecurity.errors.policyRequired),
    );
    fireEvent.change(input, { target: { value: "pw" } });
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.disable.confirm }));
    expect(await within(body().getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      en.accountSecurity.errors.policyRequired,
    );
    fireEvent.click(body().getByRole("button", { name: en.accountSecurity.disable.cancel }));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: en.accountSecurity.turnOff })).toBeNull();
    expect(screen.getByText(en.accountSecurity.policyOnNote)).toBeInTheDocument();
  });
});

describe("Arabic", () => {
  it("renders the panel in Arabic, the key and codes isolated left-to-right", async () => {
    mount(OFF, ar, "ar");
    expect(screen.getByText(ar.accountSecurity.statusOff)).toBeInTheDocument();
    expect(screen.queryByText(en.accountSecurity.statusOff)).toBeNull();
    actions.startTwoStepAction.mockResolvedValue(ok(SETUP));
    fireEvent.click(screen.getByRole("button", { name: ar.accountSecurity.turnOn }));
    const input = await screen.findByLabelText(ar.accountSecurity.setup.codeLabel);
    expect(screen.getByText(GROUPED)).toHaveAttribute("dir", "ltr");
    actions.confirmTwoStepAction.mockResolvedValue(ok({ backupCodes: CODES }));
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: ar.accountSecurity.setup.confirm }));
    const list = await screen.findByRole("list", { name: ar.accountSecurity.codes.listLabel });
    for (const item of within(list).getAllByRole("listitem")) {
      expect(item.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    }
  });

  it("formats the on-since date and the count in Arabic", () => {
    mount(ON, ar, "ar");
    expect(screen.getByText(ar.accountSecurity.statusOn)).toBeInTheDocument();
    expect(screen.getByText(/مفعّل منذ/)).toBeInTheDocument();
    expect(screen.getByText(/أكواد الطوارئ المتبقية/)).toBeInTheDocument();
  });
});

describe("Wave 1f: two-step is required for everyone on Morbeh", () => {
  const REQUIRED: OwnTwoStepStatus = { ...ON, platformRequired: true };

  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)(
    "on + platform-required (%s): no Turn off, the note, and Get new backup codes stays",
    (locale, t) => {
      mount(REQUIRED, t, locale);
      expect(screen.queryByRole("button", { name: t.accountSecurity.turnOff })).toBeNull();
      expect(screen.getByText(t.accountSecurity.platformRequired)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t.accountSecurity.newCodes })).toBeEnabled();
      // The store-level note is replaced by the platform one, not shown next to it.
      expect(screen.queryByText(t.accountSecurity.policyOnNote)).toBeNull();
    },
  );

  it("the English and Arabic notes are different sentences", () => {
    expect(ar.accountSecurity.platformRequired).not.toBe(en.accountSecurity.platformRequired);
    expect(en.accountSecurity.platformRequired).toBe("Required for everyone on Morbeh");
  });

  it("off + platform-required: Turn on stays and the note says why", () => {
    mount({ ...OFF, platformRequired: true });
    expect(screen.getByText(en.accountSecurity.platformRequired)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOn })).toBeEnabled();
  });

  it("without platformRequired (or false) Turn off is still offered", () => {
    mount(ON);
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOff })).toBeInTheDocument();
    cleanup();
    mount({ ...ON, platformRequired: false });
    expect(screen.getByRole("button", { name: en.accountSecurity.turnOff })).toBeInTheDocument();
  });

  it("a platform-required refusal from a stale page removes Turn off at once", async () => {
    mount(ON);
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.turnOff }));
    const dialog = await screen.findByRole("dialog");
    actions.disableTwoStepAction.mockResolvedValue(
      refusal("platform_required", en.accountSecurity.errors.platformRequired),
    );
    fireEvent.change(within(dialog).getByLabelText(en.accountSecurity.disable.passwordLabel), {
      target: { value: "pw" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.accountSecurity.disable.confirm }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      en.accountSecurity.errors.platformRequired,
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.accountSecurity.disable.cancel }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: en.accountSecurity.turnOff })).toBeNull();
    expect(screen.getByText(en.accountSecurity.platformRequired)).toBeInTheDocument();
  });
});

describe("Wave 1f: the authenticator-code inputs are digits only", () => {
  it("setup: digits only, the 123456 placeholder, the helper text; Confirm waits for six digits", async () => {
    mount(OFF);
    const input = (await startSetup()) as HTMLInputElement;
    expect(input).toHaveAttribute("placeholder", "123456");
    expect(screen.getByText(en.accountSecurity.codeInput.hint)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: en.accountSecurity.setup.confirm });
    fireEvent.change(input, { target: { value: "12 34-5" } });
    expect(input.value).toBe("12345");
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: "123456" } });
    expect(confirm).toBeEnabled();
  });

  it("setup: a pasted key shows the inline hint, never reaches the action, and Confirm stays off", async () => {
    mount(OFF);
    const input = (await startSetup()) as HTMLInputElement;
    fireEvent.change(input, { target: { value: KEY } });
    expect(screen.getByRole("alert")).toHaveTextContent(en.accountSecurity.codeInput.keyWarning);
    expect(screen.getByRole("button", { name: en.accountSecurity.setup.confirm })).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(actions.confirmTwoStepAction).not.toHaveBeenCalled();
  });

  it("setup: the Arabic hint and warning are Arabic", async () => {
    mount(OFF, ar, "ar");
    actions.startTwoStepAction.mockResolvedValue(ok(SETUP));
    fireEvent.click(screen.getByRole("button", { name: ar.accountSecurity.turnOn }));
    const input = await screen.findByLabelText(ar.accountSecurity.setup.codeLabel);
    expect(screen.getByText(ar.accountSecurity.codeInput.hint)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: KEY } });
    expect(screen.getByRole("alert")).toHaveTextContent(ar.accountSecurity.codeInput.keyWarning);
    expect(ar.accountSecurity.codeInput.hint).not.toBe(en.accountSecurity.codeInput.hint);
  });

  it("new backup codes: digits only, a pasted key is caught and never sent", async () => {
    mount(ON);
    fireEvent.click(screen.getByRole("button", { name: en.accountSecurity.newCodes }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(
      en.accountSecurity.regenerate.codeLabel,
    ) as HTMLInputElement;
    expect(input).toHaveAttribute("placeholder", "123456");
    expect(within(dialog).getByText(en.accountSecurity.codeInput.hint)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", {
      name: en.accountSecurity.regenerate.submit,
    });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: KEY } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      en.accountSecurity.codeInput.keyWarning,
    );
    expect(submit).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(actions.regenerateBackupCodesAction).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "65432" } });
    fireEvent.change(input, { target: { value: "654321" } });
    expect(submit).toBeEnabled();
  });
});
