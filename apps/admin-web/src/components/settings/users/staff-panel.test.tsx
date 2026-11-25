import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffMemberView } from "@/lib/staff/roles";
import type { StaffSecurityPolicy } from "@/lib/staff/two-step";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({
  inviteStaffAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
  changeStaffRoleAction: vi.fn(),
  setStaffActiveAction: vi.fn(),
  setRequireTwoStepAction: vi.fn(),
}));
vi.mock("@/app/settings/users/actions", () => actions);

const { StaffPanel } = await import("./staff-panel");

const body = () => within(document.body);
const NOW = "2026-11-24T12:00:00.000Z";
const SUCCESS = { status: "success" } as const;
const POLICY: StaffSecurityPolicy = {
  requireTwoStep: false,
  codeStepAvailable: true,
  activeStaff: 3,
  enrolledActiveStaff: 0,
  notEnrolled: [],
  pendingInvitations: 0,
};

function member(
  overrides: Partial<StaffMemberView> & { email: string; principalExternalId: string },
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

const OWNER = member({
  principalExternalId: "pid-owner",
  email: "owner@shop.example",
  role: "owner",
  isOwner: true,
  lastSignInAt: "2026-11-24T08:00:00.000Z",
});
const ME = member({
  principalExternalId: "pid-me",
  email: "me@shop.example",
  role: "admin",
  isSelf: true,
  lastSignInAt: "2026-11-24T11:30:00.000Z",
});
const SAM = member({
  principalExternalId: "pid-sam",
  email: "sam@shop.example",
  role: "operator",
  lastSignInAt: "2026-11-21T12:00:00.000Z",
});
const LEE = member({
  principalExternalId: "pid-lee",
  email: "lee@shop.example",
  role: "viewer",
  status: "deactivated",
});
const ANN = member({
  principalExternalId: "pid-ann",
  email: "ann@shop.example",
  role: "viewer",
  status: "invited",
  invitation: { id: "inv-ann", expiresAt: "2026-11-30T10:00:00.000Z", version: 2 },
});
const BOB = member({
  principalExternalId: "pid-bob",
  email: "bob@shop.example",
  role: "operator",
  status: "invitation_expired",
  invitation: { id: "inv-bob", expiresAt: "2026-11-20T10:00:00.000Z", version: 5 },
});

/** A row with no actions (an owner), placed after the others. */
const OWNER_AFTER = member({
  principalExternalId: "pid-zed",
  email: "zed@shop.example",
  role: "owner",
  isOwner: true,
});

const ALL = [OWNER, ME, SAM, LEE, ANN, BOB];

type Props = Parameters<typeof StaffPanel>[0];

function panel(
  members: readonly StaffMemberView[],
  t: Dictionary = en,
  locale: "en" | "ar" = "en",
): Props {
  return { members, policy: POLICY, t, locale, nowIso: NOW };
}

function mount(
  members: readonly StaffMemberView[] = ALL,
  t: Dictionary = en,
  locale: "en" | "ar" = "en",
) {
  const view = render(<StaffPanel {...panel(members, t, locale)} />);
  return {
    ...view,
    update: (next: readonly StaffMemberView[]) =>
      view.rerender(<StaffPanel {...panel(next, t, locale)} />),
  };
}

const addStaff = (t: Dictionary = en) => screen.getByRole("button", { name: t.users.addStaff });
const rowButton = (email: string, t: Dictionary = en) =>
  screen.getByRole("button", { name: t.users.menu.label.replace("{email}", email) });

function pickFromMenu(email: string): HTMLElement {
  const trigger = rowButton(email);
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

async function choose(email: string, item: string): Promise<HTMLElement> {
  const trigger = pickFromMenu(email);
  fireEvent.click(await body().findByRole("menuitem", { name: item }));
  return trigger;
}

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
  for (const mock of Object.values(actions)) mock.mockReset();
  for (const mock of Object.values(actions)) mock.mockResolvedValue(SUCCESS);
});

describe("the staff table", () => {
  it("renders every status with its badge, the roles, last signed in, and the owner badge", () => {
    mount();
    const table = screen.getByRole("region", { name: en.users.listLabel });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);

    const ownerRow = rows[0]!;
    expect(within(ownerRow).getByText("Owner")).toBeInTheDocument();
    expect(within(ownerRow).getByText("owner@shop.example")).toBeInTheDocument();
    expect(within(ownerRow).getByText("4 hours ago")).toBeInTheDocument();

    expect(within(rows[1]!).getByText("Admin")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Active")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Operator")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("3 days ago")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Deactivated")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Never")).toBeInTheDocument();
    expect(within(rows[4]!).getByText("Invited")).toBeInTheDocument();
    expect(within(rows[5]!).getByText("Invitation expired")).toBeInTheDocument();
  });

  it("the owner row and your own row have no actions at all; the others each have a menu", () => {
    mount();
    const buttons = within(document.body)
      .queryAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter((label): label is string => label !== null && label.startsWith("Actions for"));
    expect(buttons).toEqual([
      "Actions for sam@shop.example",
      "Actions for lee@shop.example",
      "Actions for ann@shop.example",
      "Actions for bob@shop.example",
    ]);
    expect(body().queryByRole("button", { name: /owner@shop.example/ })).toBeNull();
    expect(body().queryByRole("button", { name: /me@shop.example/ })).toBeNull();
    // Your own row is marked; the owner's is not.
    expect(body().getByText("(you)")).toBeInTheDocument();
  });

  it("each email sits in a <bdi dir=auto>", () => {
    mount();
    for (const email of ["owner@shop.example", "me@shop.example", "ann@shop.example"]) {
      const element = body().getByText(email);
      expect(element.tagName).toBe("BDI");
      expect(element).toHaveAttribute("dir", "auto");
    }
  });

  it.each([
    ["sam@shop.example", ["Change role", "Deactivate"]],
    ["lee@shop.example", ["Change role", "Reactivate"]],
    ["ann@shop.example", ["Change role", "Resend invitation", "Revoke invitation"]],
    ["bob@shop.example", ["Change role", "Resend invitation", "Revoke invitation"]],
  ])("the menu for %s offers exactly %j", async (email, expected) => {
    mount();
    pickFromMenu(email);
    const items = await body().findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(expected);
  });

  it("never puts an internal id, an invitation id or a secret into the page", () => {
    const { container } = mount();
    const html = document.body.innerHTML + container.innerHTML;
    for (const secret of ["pid-", "inv-ann", "inv-bob", "token", "hash", "password"]) {
      expect(html.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("renders in Arabic from ar.users, with the same bdi emails", async () => {
    mount(ALL, ar, "ar");
    expect(body().getByRole("heading", { level: 1, name: ar.users.title })).toBeInTheDocument();
    expect(body().getByRole("button", { name: ar.users.addStaff })).toBeInTheDocument();
    expect(body().getByText(ar.users.roles.owner)).toBeInTheDocument();
    expect(body().getByText(ar.users.statuses.invitation_expired)).toBeInTheDocument();
    expect(body().getByText(ar.users.you)).toBeInTheDocument();
    expect(body().getByText("owner@shop.example").tagName).toBe("BDI");
    expect(body().queryByText(en.users.title)).toBeNull();

    fireEvent.keyDown(rowButton("sam@shop.example", ar), { key: "Enter" });
    fireEvent.click(await body().findByRole("menuitem", { name: ar.users.menu.deactivate }));
    const dialog = await body().findByRole("dialog", { name: ar.users.deactivate.title });
    expect(dialog).toHaveAccessibleDescription(/sam@shop\.example/);
    expect(dialog).toHaveAccessibleDescription(
      /^سيفقد\s+sam@shop\.example\s+إمكانية الوصول خلال 30 ثانية\.$/,
    );
    expect(within(dialog).queryByText(en.users.deactivate.title)).toBeNull();
  });
});

describe("the invite dialog", () => {
  it("opens with a title and a description, focus in the email field, and a role with its description", async () => {
    mount();
    fireEvent.click(addStaff());

    const dialog = await body().findByRole("dialog", { name: "Add staff" });
    expect(dialog).toHaveAccessibleDescription(
      "They get an email with a link that works for 7 days.",
    );
    await waitFor(() => expect(within(dialog).getByLabelText("Email")).toHaveFocus());
    for (const role of ["Admin", "Operator", "Viewer"]) {
      expect(
        within(dialog).getByRole("radio", { name: new RegExp(`^${role}`) }),
      ).toBeInTheDocument();
    }
    expect(within(dialog).getByText(en.users.roleDescriptions.viewer)).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /^Operator/ })).toBeChecked();
  });

  it("Escape closes it, focus returns to Add staff, and nothing is sent", async () => {
    mount();
    fireEvent.click(addStaff());
    const dialog = await body().findByRole("dialog", { name: "Add staff" });

    escape(dialog);

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(addStaff()).toHaveFocus());
    expect(actions.inviteStaffAction).not.toHaveBeenCalled();
  });

  it("checks the email before sending: empty and malformed addresses never reach the action", async () => {
    mount();
    fireEvent.click(addStaff());
    const dialog = await body().findByRole("dialog", { name: "Add staff" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      en.users.errors.emailInvalid,
    );

    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      en.users.errors.emailInvalid,
    );
    expect(within(dialog).getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(actions.inviteStaffAction).not.toHaveBeenCalled();
  });

  it("sends the trimmed email with the chosen role, closes on success and announces it", async () => {
    mount();
    fireEvent.click(addStaff());
    const dialog = await body().findByRole("dialog", { name: "Add staff" });
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "  new@shop.example " },
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Viewer/ }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(actions.inviteStaffAction).toHaveBeenCalledTimes(1);
    expect(actions.inviteStaffAction).toHaveBeenCalledWith({
      email: "new@shop.example",
      role: "viewer",
    });
    expect(body().getByRole("status")).toHaveTextContent("Invitation sent to new@shop.example.");
    await waitFor(() => expect(addStaff()).toHaveFocus());
  });

  it("shows a 409 inside the open dialog and keeps what was typed", async () => {
    actions.inviteStaffAction.mockResolvedValue({
      status: "error",
      message: en.users.errors.alreadyPending,
      fieldErrors: {},
    });
    mount();
    fireEvent.click(addStaff());
    const dialog = await body().findByRole("dialog", { name: "Add staff" });
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "ann@shop.example" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      en.users.errors.alreadyPending,
    );
    expect(body().getByRole("dialog", { name: "Add staff" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toHaveValue("ann@shop.example");
  });

  it("puts a server 422 on the email under the field", async () => {
    actions.inviteStaffAction.mockResolvedValue({
      status: "error",
      message: en.users.errors.emailInvalid,
      fieldErrors: { email: en.users.errors.emailInvalid },
    });
    mount();
    fireEvent.click(addStaff());
    const dialog = await body().findByRole("dialog", { name: "Add staff" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(en.users.errors.emailInvalid);
    expect(within(dialog).getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the 'email isn't set up' text for a 503 and the dialog stays open", async () => {
    actions.inviteStaffAction.mockResolvedValue({
      status: "error",
      message: en.users.errors.notConfigured,
      fieldErrors: {},
      code: "NOT_CONFIGURED",
    });
    mount();
    fireEvent.click(addStaff());
    const dialog = await body().findByRole("dialog", { name: "Add staff" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Email isn't set up, so invitations can't be sent",
    );
    expect(body().getByRole("dialog", { name: "Add staff" })).toBeInTheDocument();
    expect(body().queryByRole("button", { name: "Resend" })).toBeNull();
  });

  it("a 502 closes the dialog and shows a warning banner whose Resend uses the saved invitation", async () => {
    actions.inviteStaffAction.mockResolvedValue({
      status: "error",
      message: en.users.errors.emailFailed,
      fieldErrors: {},
      code: "EMAIL_FAILED",
    });
    const view = mount();
    fireEvent.click(addStaff());
    const dialog = await body().findByRole("dialog", { name: "Add staff" });
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "New@Shop.example" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    const banner = body().getByRole("alert");
    expect(banner).toHaveTextContent(
      "The invitation to New@Shop.example was saved, but the email couldn't be sent.",
    );
    // Until the refreshed list holds the saved invitation, Resend cannot know which one to send.
    expect(within(banner).getByRole("button", { name: "Resend" })).toBeDisabled();

    const saved = member({
      principalExternalId: "pid-new",
      email: "new@shop.example",
      role: "operator",
      status: "invited",
      invitation: { id: "inv-new", expiresAt: "2026-12-01T10:00:00.000Z", version: 1 },
    });
    view.update([...ALL, saved]);
    const resend = within(body().getByRole("alert")).getByRole("button", { name: "Resend" });
    expect(resend).toBeEnabled();
    fireEvent.click(resend);

    await waitFor(() => expect(actions.resendInvitationAction).toHaveBeenCalledWith("inv-new", 1));
    await waitFor(() => expect(body().queryByText(/was saved, but the email/)).toBeNull());
    expect(body().getByRole("status")).toHaveTextContent("Invitation sent to new@shop.example.");
  });

  it("while sending the button is busy and disabled, and Escape still closes; reopening shows the same request", async () => {
    const pending = hold();
    actions.inviteStaffAction.mockImplementation(() => pending.promise);
    mount();
    fireEvent.click(addStaff());
    const dialog = await body().findByRole("dialog", { name: "Add staff" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "x@y.co" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));
    const busy = await within(dialog).findByRole("button", { name: "Sending…" });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();

    escape(dialog);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());

    fireEvent.click(addStaff());
    const again = await body().findByRole("dialog", { name: "Add staff" });
    expect(within(again).getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(actions.inviteStaffAction).toHaveBeenCalledTimes(1);

    await act(async () => pending.settle(SUCCESS));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
  });
});

describe("the change-role dialog", () => {
  it("starts on the member's current role, saves the chosen one and returns focus to the row's button", async () => {
    mount();
    const trigger = await choose("sam@shop.example", "Change role");
    const dialog = await body().findByRole("dialog", { name: "Change role" });
    expect(dialog).toHaveAccessibleDescription("Choose what sam@shop.example can do.");
    expect(within(dialog).getByRole("radio", { name: /^Operator/ })).toBeChecked();

    fireEvent.click(within(dialog).getByRole("radio", { name: /^Admin/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save role" }));

    await waitFor(() =>
      expect(actions.changeStaffRoleAction).toHaveBeenCalledWith("pid-sam", "admin"),
    );
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows the server's refusal (a 403 and a 409) in the dialog, never assuming success", async () => {
    actions.changeStaffRoleAction.mockResolvedValueOnce({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    mount();
    await choose("sam@shop.example", "Change role");
    const dialog = await body().findByRole("dialog", { name: "Change role" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save role" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(en.formErrors.forbidden);

    actions.changeStaffRoleAction.mockResolvedValueOnce({
      status: "error",
      message: en.users.errors.lastAdmin,
      fieldErrors: {},
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save role" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(en.users.errors.lastAdmin),
    );
    expect(body().getByRole("dialog", { name: "Change role" })).toBeInTheDocument();
  });

  it("reopening starts clean", async () => {
    actions.changeStaffRoleAction.mockResolvedValue({
      status: "error",
      message: en.users.errors.stale,
      fieldErrors: {},
    });
    mount();
    await choose("sam@shop.example", "Change role");
    const dialog = await body().findByRole("dialog", { name: "Change role" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save role" }));
    await within(dialog).findByRole("alert");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());

    await choose("sam@shop.example", "Change role");
    const again = await body().findByRole("dialog", { name: "Change role" });
    expect(within(again).queryByRole("alert")).toBeNull();
  });
});

describe("the deactivate confirmation", () => {
  it("is titled and described with the email in a bdi, and focus starts on Cancel, not on Deactivate", async () => {
    mount();
    await choose("sam@shop.example", "Deactivate");

    const dialog = await body().findByRole("dialog", { name: "Deactivate this person?" });
    expect(dialog).toHaveAccessibleDescription(
      "sam@shop.example will lose access within 30 seconds.",
    );
    const email = within(dialog).getByText("sam@shop.example");
    expect(email.tagName).toBe("BDI");
    expect(email).toHaveAttribute("dir", "auto");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
    expect(within(dialog).getByRole("button", { name: "Deactivate" })).not.toHaveFocus();
  });

  it("Escape and Cancel close it, focus returns to the row's button, and nothing is sent", async () => {
    mount();
    const trigger = await choose("sam@shop.example", "Deactivate");
    const dialog = await body().findByRole("dialog", { name: "Deactivate this person?" });
    escape(dialog);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());

    await choose("sam@shop.example", "Deactivate");
    await body().findByRole("dialog", { name: "Deactivate this person?" });
    fireEvent.click(body().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.setStaffActiveAction).not.toHaveBeenCalled();
  });

  it("confirming deactivates once with active=false and focus returns to the still-mounted button", async () => {
    mount();
    const trigger = await choose("sam@shop.example", "Deactivate");
    const dialog = await body().findByRole("dialog", { name: "Deactivate this person?" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(actions.setStaffActiveAction).toHaveBeenCalledTimes(1);
    expect(actions.setStaffActiveAction).toHaveBeenCalledWith("pid-sam", false);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("while pending: busy and disabled, Cancel and Escape still close, and the request is not repeated", async () => {
    const pending = hold();
    actions.setStaffActiveAction.mockImplementation(() => pending.promise);
    mount();
    const trigger = await choose("sam@shop.example", "Deactivate");
    const dialog = await body().findByRole("dialog", { name: "Deactivate this person?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    const busy = await within(dialog).findByRole("button", { name: "Deactivating…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();

    escape(dialog);

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());

    await choose("sam@shop.example", "Deactivate");
    const again = await body().findByRole("dialog", { name: "Deactivate this person?" });
    const stillBusy = within(again).getByRole("button", { name: "Deactivating…" });
    fireEvent.click(stillBusy);
    expect(actions.setStaffActiveAction).toHaveBeenCalledTimes(1);

    await act(async () => pending.settle(SUCCESS));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
  });

  it("shows a refusal inside the open dialog (403 text), which stays open", async () => {
    actions.setStaffActiveAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    mount();
    await choose("sam@shop.example", "Deactivate");
    const dialog = await body().findByRole("dialog", { name: "Deactivate this person?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(en.formErrors.forbidden);
    expect(body().getByRole("dialog", { name: "Deactivate this person?" })).toBeInTheDocument();
  });

  it("an error that lands after Escape does not reopen the dialog; it shows in the page notice", async () => {
    const pending = hold();
    actions.setStaffActiveAction.mockImplementation(() => pending.promise);
    mount();
    await choose("sam@shop.example", "Deactivate");
    const dialog = await body().findByRole("dialog", { name: "Deactivate this person?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await within(dialog).findByRole("button", { name: "Deactivating…" });
    escape(dialog);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());

    await act(async () => {
      pending.settle({
        status: "error",
        message: en.users.errors.ownerDeactivate,
        fieldErrors: {},
      });
    });

    expect(await body().findByRole("alert")).toHaveTextContent(en.users.errors.ownerDeactivate);
    expect(body().queryByRole("dialog")).toBeNull();
  });

  it("Reactivate needs no confirmation: it acts at once and says so", async () => {
    mount();
    await choose("lee@shop.example", "Reactivate");

    await waitFor(() => expect(actions.setStaffActiveAction).toHaveBeenCalledWith("pid-lee", true));
    expect(body().queryByRole("dialog")).toBeNull();
    expect(await body().findByRole("status")).toHaveTextContent(
      "lee@shop.example can sign in again.",
    );
  });
});

describe("resend and revoke", () => {
  it("Resend sends the invitation again with the loaded version and says so", async () => {
    mount();
    await choose("ann@shop.example", "Resend invitation");

    await waitFor(() => expect(actions.resendInvitationAction).toHaveBeenCalledWith("inv-ann", 2));
    expect(await body().findByRole("status")).toHaveTextContent(
      "Invitation sent to ann@shop.example.",
    );
  });

  it("a failed Resend shows the server's reason in the page", async () => {
    actions.resendInvitationAction.mockResolvedValue({
      status: "error",
      message: en.users.errors.stale,
      fieldErrors: {},
    });
    mount();
    await choose("bob@shop.example", "Resend invitation");

    expect(await body().findByRole("alert")).toHaveTextContent(en.users.errors.stale);
  });

  it("Revoke is a destructive confirm: title, description with the email, focus on Cancel", async () => {
    mount();
    await choose("ann@shop.example", "Revoke invitation");

    const dialog = await body().findByRole("dialog", { name: "Revoke this invitation?" });
    expect(dialog).toHaveAccessibleDescription(
      "The link sent to ann@shop.example will stop working.",
    );
    expect(within(dialog).getByText("ann@shop.example").tagName).toBe("BDI");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
    expect(actions.revokeInvitationAction).not.toHaveBeenCalled();
  });

  it("confirming revokes with the invitation id and version", async () => {
    mount();
    await choose("bob@shop.example", "Revoke invitation");
    const dialog = await body().findByRole("dialog", { name: "Revoke this invitation?" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));

    await waitFor(() => expect(actions.revokeInvitationAction).toHaveBeenCalledWith("inv-bob", 5));
    expect(actions.revokeInvitationAction).toHaveBeenCalledTimes(1);
  });

  it("a stale 409 stays in the dialog", async () => {
    actions.revokeInvitationAction.mockResolvedValue({
      status: "error",
      message: en.users.errors.stale,
      fieldErrors: {},
    });
    mount();
    const trigger = await choose("ann@shop.example", "Revoke invitation");
    const dialog = await body().findByRole("dialog", { name: "Revoke this invitation?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(en.users.errors.stale);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  describe("focus after the revoked row disappears", () => {
    async function revoke(
      view: ReturnType<typeof mount>,
      email: string,
      remaining: readonly StaffMemberView[],
    ) {
      await choose(email, "Revoke invitation");
      const dialog = await body().findByRole("dialog", { name: "Revoke this invitation?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
      await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
      view.update(remaining);
    }

    it("goes to the next surviving row's actions button", async () => {
      const view = mount();
      await revoke(view, "ann@shop.example", [OWNER, ME, SAM, LEE, BOB]);
      await waitFor(() => expect(rowButton("bob@shop.example")).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    });

    it("else the previous one when the revoked row was last", async () => {
      const view = mount();
      await revoke(view, "bob@shop.example", [OWNER, ME, SAM, LEE, ANN]);
      await waitFor(() => expect(rowButton("ann@shop.example")).toHaveFocus());
    });

    it("skips rows with no actions button (the owner's and your own)", async () => {
      const view = mount([OWNER, ME, ANN, OWNER_AFTER]);
      await revoke(view, "ann@shop.example", [OWNER, ME, OWNER_AFTER]);
      await waitFor(() => expect(addStaff()).toHaveFocus());
    });

    it("else Add staff when no row with actions is left", async () => {
      const view = mount([OWNER, ME, ANN]);
      await revoke(view, "ann@shop.example", [OWNER, ME]);
      await waitFor(() => expect(addStaff()).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    });

    it("Escape racing the success still lands on a surviving row, never on body", async () => {
      const pending = hold();
      actions.revokeInvitationAction.mockImplementation(() => pending.promise);
      const view = mount();
      await choose("ann@shop.example", "Revoke invitation");
      const dialog = await body().findByRole("dialog", { name: "Revoke this invitation?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
      await within(dialog).findByRole("button", { name: "Revoking…" });
      escape(dialog);
      await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());

      await act(async () => pending.settle(SUCCESS));
      view.update([OWNER, ME, SAM, LEE, BOB]);

      await waitFor(() => expect(rowButton("bob@shop.example")).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    });
  });
});

describe("two-step (Wave 1e)", () => {
  it("shows a 2-step column with On and Off badges from twoStep", () => {
    mount([
      member({ principalExternalId: "pid-on", email: "on@shop.example", twoStep: true }),
      member({ principalExternalId: "pid-off", email: "off@shop.example", twoStep: false }),
    ]);
    expect(
      screen.getByRole("columnheader", { name: en.users.columns.twoStep }),
    ).toBeInTheDocument();
    const onRow = screen.getByText("on@shop.example").closest("tr") as HTMLElement;
    const offRow = screen.getByText("off@shop.example").closest("tr") as HTMLElement;
    expect(within(onRow).getByText(en.users.twoStepBadge.on)).toBeInTheDocument();
    expect(within(offRow).getByText(en.users.twoStepBadge.off)).toBeInTheDocument();
  });

  it("renders the column in Arabic", () => {
    mount(
      [member({ principalExternalId: "pid-on", email: "on@shop.example", twoStep: true })],
      ar,
      "ar",
    );
    expect(
      screen.getByRole("columnheader", { name: ar.users.columns.twoStep }),
    ).toBeInTheDocument();
    expect(screen.getByText(ar.users.twoStepBadge.on)).toBeInTheDocument();
  });

  it("links to the activity page from the header", () => {
    mount();
    expect(screen.getByRole("link", { name: en.users.viewActivity })).toHaveAttribute(
      "href",
      "/settings/users/activity",
    );
  });

  it("renders the policy card above the table", () => {
    mount();
    expect(
      screen.getByRole("switch", { name: new RegExp(en.usersPolicy.switchLabel) }),
    ).toBeInTheDocument();
    const card = screen.getByRole("switch").closest("div") as HTMLElement;
    const table = screen.getByRole("table");
    expect(card.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
