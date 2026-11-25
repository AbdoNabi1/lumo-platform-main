import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffMemberView } from "@/lib/staff/roles";
import type { StaffSecurityPolicy } from "@/lib/staff/two-step";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({ setRequireTwoStepAction: vi.fn() }));
vi.mock("@/app/settings/users/actions", () => actions);

const { TwoStepPolicyCard, policyBlocker } = await import("./two-step-policy-card");

const body = () => within(document.body);

function member(
  overrides: Partial<StaffMemberView> & { principalExternalId: string; email: string },
): StaffMemberView {
  return {
    role: "viewer",
    status: "active",
    isOwner: false,
    isSelf: false,
    addedAt: "2026-11-01T10:00:00.000Z",
    lastSignInAt: null,
    twoStep: false,
    invitation: null,
    ...overrides,
  };
}

const ME = member({
  principalExternalId: "pid-me",
  email: "me@shop.example",
  role: "admin",
  isSelf: true,
  twoStep: true,
});
const SAM = member({
  principalExternalId: "pid-sam",
  email: "sam@shop.example",
  role: "operator",
  twoStep: true,
});
const MONA = member({
  principalExternalId: "pid-mona",
  email: "mona@shop.example",
  twoStep: false,
});

const READY: StaffSecurityPolicy = {
  requireTwoStep: false,
  codeStepAvailable: true,
  activeStaff: 2,
  enrolledActiveStaff: 2,
  notEnrolled: [],
  pendingInvitations: 0,
};
const ON: StaffSecurityPolicy = { ...READY, requireTwoStep: true };

function mount(
  policy: StaffSecurityPolicy | null,
  members: readonly StaffMemberView[] = [ME, SAM],
  t: Dictionary = en,
) {
  const view = render(<TwoStepPolicyCard policy={policy} members={members} t={t} />);
  return {
    ...view,
    update: (next: StaffSecurityPolicy | null) =>
      view.rerender(<TwoStepPolicyCard policy={next} members={members} t={t} />),
  };
}

const theSwitch = (t: Dictionary = en) =>
  screen.getByRole("switch", { name: new RegExp(t.usersPolicy.switchLabel), hidden: true });
const escape = (element: HTMLElement) => fireEvent.keyDown(element, { key: "Escape" });

function hold() {
  let settle!: (value: unknown) => void;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, settle: (value: unknown) => settle(value) };
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
  actions.setRequireTwoStepAction.mockReset();
  actions.setRequireTwoStepAction.mockResolvedValue({ status: "success" });
});

describe("policyBlocker", () => {
  it("names the first thing in the way, in the server's own order", () => {
    expect(
      policyBlocker(
        {
          ...READY,
          codeStepAvailable: false,
          notEnrolled: [{ principalExternalId: "x", email: "x@y.z" }],
        },
        [ME],
      ),
    ).toBe("unavailable");
    expect(policyBlocker(READY, [{ ...ME, twoStep: false }, SAM])).toBe("selfFirst");
    expect(
      policyBlocker(
        {
          ...READY,
          notEnrolled: [{ principalExternalId: "pid-mona", email: "mona@shop.example" }],
          pendingInvitations: 2,
        },
        [ME, MONA],
      ),
    ).toBe("everyoneFirst");
    expect(policyBlocker({ ...READY, pendingInvitations: 1 }, [ME, SAM])).toBe(
      "pendingInvitations",
    );
    expect(policyBlocker(READY, [ME, SAM])).toBeNull();
  });
});

describe("the switch", () => {
  it("shows the server's value: off", () => {
    mount(READY);
    expect(theSwitch()).not.toBeChecked();
    expect(theSwitch()).toBeEnabled();
    expect(screen.getByText(en.usersPolicy.stateOff)).toBeInTheDocument();
  });

  it("shows the server's value: on", () => {
    mount(ON);
    expect(theSwitch()).toBeChecked();
    expect(screen.getByText(en.usersPolicy.stateOn)).toBeInTheDocument();
  });

  it("can't be turned on while someone has no two-step: the reason and the list, emails in bdi", () => {
    mount(
      {
        ...READY,
        enrolledActiveStaff: 1,
        notEnrolled: [{ principalExternalId: "pid-mona", email: "mona@shop.example" }],
      },
      [ME, MONA],
    );
    expect(theSwitch()).toBeDisabled();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(en.usersPolicy.cantEnable);
    expect(note).toHaveTextContent(en.usersPolicy.errors.everyoneFirst);
    expect(screen.getByText(en.usersPolicy.missingHeading)).toBeInTheDocument();
    const email = screen.getByText("mona@shop.example");
    expect(email.tagName).toBe("BDI");
    expect(email).toHaveAttribute("dir", "auto");
  });

  it("asks you to turn on your own two-step first, with a link to it", () => {
    mount(
      {
        ...READY,
        enrolledActiveStaff: 1,
        notEnrolled: [{ principalExternalId: "pid-me", email: "me@shop.example" }],
      },
      [{ ...ME, twoStep: false }, SAM],
    );
    expect(theSwitch()).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(en.usersPolicy.errors.selfFirst);
    expect(screen.getByRole("link", { name: en.usersPolicy.accountLink })).toHaveAttribute(
      "href",
      "/account/security",
    );
  });

  it.each([
    ["the code step isn't live", { ...READY, codeStepAvailable: false }, "unavailable"],
    ["there are pending invitations", { ...READY, pendingInvitations: 2 }, "pendingInvitations"],
  ] as const)("can't be turned on when %s", (_name, policy, key) => {
    mount(policy);
    expect(theSwitch()).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(en.usersPolicy.errors[key]);
  });

  it("can always be turned off, even when the blockers would stop turning it on", () => {
    mount({ ...ON, codeStepAvailable: false, pendingInvitations: 3 });
    expect(theSwitch()).toBeEnabled();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("without a policy (the load failed) says so and offers no switch", () => {
    mount(null);
    expect(screen.getByRole("alert")).toHaveTextContent(en.usersPolicy.loadError);
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("turning it on", () => {
  it("asks first (title, description, initial focus on Cancel) and sends nothing on Cancel", async () => {
    mount(READY);
    const trigger = theSwitch();
    fireEvent.click(trigger);
    const dialog = await body().findByRole("dialog");
    expect(within(dialog).getByText(en.usersPolicy.enable.title)).toBeInTheDocument();
    expect(within(dialog).getByText(en.usersPolicy.enable.description)).toHaveTextContent(
      "Everyone will need a code at every sign-in.",
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: en.usersPolicy.enable.cancel }),
      ).toHaveFocus(),
    );
    expect(trigger).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: en.usersPolicy.enable.cancel }));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.setRequireTwoStepAction).not.toHaveBeenCalled();
  });

  it("Confirm sends enabled=true; the switch flips and a notice says so", async () => {
    mount(READY);
    fireEvent.click(theSwitch());
    fireEvent.click(await body().findByRole("button", { name: en.usersPolicy.enable.confirm }));
    await waitFor(() => expect(theSwitch()).toBeChecked());
    expect(actions.setRequireTwoStepAction).toHaveBeenCalledWith(true);
    expect(screen.getByRole("status")).toHaveTextContent(en.usersPolicy.notices.enabled);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(theSwitch()).toHaveFocus());
  });

  it("shows the server's refusal inside the dialog and leaves the switch off", async () => {
    mount(READY);
    actions.setRequireTwoStepAction.mockResolvedValue({
      status: "error",
      message: en.usersPolicy.errors.everyoneFirst,
      fieldErrors: {},
    });
    fireEvent.click(theSwitch());
    fireEvent.click(await body().findByRole("button", { name: en.usersPolicy.enable.confirm }));
    expect(await within(body().getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      en.usersPolicy.errors.everyoneFirst,
    );
    expect(theSwitch()).not.toBeChecked();
  });

  it("an unknown conflict shows the generic sentence the action produced", async () => {
    mount(READY);
    actions.setRequireTwoStepAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.conflict,
      fieldErrors: {},
    });
    fireEvent.click(theSwitch());
    fireEvent.click(await body().findByRole("button", { name: en.usersPolicy.enable.confirm }));
    expect(await within(body().getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      en.formErrors.conflict,
    );
  });

  it("Escape while pending closes the dialog; the outcome still lands in the card", async () => {
    mount(READY);
    const gate = hold();
    actions.setRequireTwoStepAction.mockReturnValue(gate.promise);
    fireEvent.click(theSwitch());
    fireEvent.click(await body().findByRole("button", { name: en.usersPolicy.enable.confirm }));
    await waitFor(() =>
      expect(body().getByRole("button", { name: en.usersPolicy.enable.confirming })).toBeDisabled(),
    );
    escape(body().getByRole("dialog"));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await act(async () => gate.settle({ status: "success" }));
    expect(theSwitch()).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(en.usersPolicy.notices.enabled);
  });

  it("a refusal that lands after the dialog was dismissed shows in the card", async () => {
    mount(READY);
    const gate = hold();
    actions.setRequireTwoStepAction.mockReturnValue(gate.promise);
    fireEvent.click(theSwitch());
    fireEvent.click(await body().findByRole("button", { name: en.usersPolicy.enable.confirm }));
    escape(body().getByRole("dialog"));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await act(async () =>
      gate.settle({
        status: "error",
        message: en.usersPolicy.errors.pendingInvitations,
        fieldErrors: {},
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.usersPolicy.errors.pendingInvitations,
    );
    expect(theSwitch()).not.toBeChecked();
  });
});

describe("turning it off", () => {
  it("asks first with a destructive confirm, initial focus on Cancel", async () => {
    mount(ON);
    fireEvent.click(theSwitch());
    const dialog = await body().findByRole("dialog");
    expect(within(dialog).getByText(en.usersPolicy.disable.title)).toBeInTheDocument();
    expect(within(dialog).getByText(en.usersPolicy.disable.description)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: en.usersPolicy.disable.cancel }),
      ).toHaveFocus(),
    );
    escape(dialog);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(actions.setRequireTwoStepAction).not.toHaveBeenCalled();
    expect(theSwitch()).toBeChecked();
  });

  it("Confirm sends enabled=false and flips the switch off", async () => {
    mount(ON);
    fireEvent.click(theSwitch());
    fireEvent.click(await body().findByRole("button", { name: en.usersPolicy.disable.confirm }));
    await waitFor(() => expect(theSwitch()).not.toBeChecked());
    expect(actions.setRequireTwoStepAction).toHaveBeenCalledWith(false);
    expect(screen.getByRole("status")).toHaveTextContent(en.usersPolicy.notices.disabled);
  });

  it("a newer server value replaces what this card assumed", async () => {
    const view = mount(ON);
    fireEvent.click(theSwitch());
    fireEvent.click(await body().findByRole("button", { name: en.usersPolicy.disable.confirm }));
    await waitFor(() => expect(theSwitch()).not.toBeChecked());
    view.update({ ...ON });
    expect(theSwitch()).toBeChecked();
  });
});

describe("Arabic", () => {
  it("renders the card, the reason and the list in Arabic with emails in bdi", () => {
    mount(
      {
        ...READY,
        enrolledActiveStaff: 1,
        notEnrolled: [{ principalExternalId: "pid-mona", email: "mona@shop.example" }],
      },
      [ME, MONA],
      ar,
    );
    expect(
      screen.getByRole("switch", { name: new RegExp(ar.usersPolicy.switchLabel) }),
    ).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(ar.usersPolicy.errors.everyoneFirst);
    expect(screen.queryByText(en.usersPolicy.cantEnable)).toBeNull();
    expect(screen.getByText("mona@shop.example").tagName).toBe("BDI");
  });
});
