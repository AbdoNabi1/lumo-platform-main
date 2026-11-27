import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  updateCustomerProfileAction: vi.fn(),
  setCustomerNoteAction: vi.fn(),
  setCustomerTagsAction: vi.fn(),
  changeMarketingConsentAction: vi.fn(),
}));
vi.mock("@/app/customers/actions", () => actions);

const { CustomerOverviewCard } = await import("./customer-overview-card");
const { CustomerNoteCard } = await import("./customer-note-card");
const { CustomerTagsCard } = await import("./customer-tags-card");
const { CustomerMarketingCard } = await import("./customer-marketing-card");

const body = () => within(document.body);
const OK = { status: "success" } as const;
const ID = "c-1";

const customer = {
  id: ID,
  name: "Nour Hassan",
  email: "nour@example.com",
  phone: "+201001234567",
  language: "ar" as const,
  isGuest: false,
};

beforeEach(() => {
  expect.hasAssertions();
  for (const fn of Object.values(actions)) fn.mockReset();
});

describe("CustomerOverviewCard", () => {
  it("shows name, email, phone and language, names and emails isolated in bdi", () => {
    render(<CustomerOverviewCard customer={customer} canEdit={false} t={en} />);

    for (const text of ["Nour Hassan", "nour@example.com"]) {
      const element = body().getByText(text);
      expect(element.tagName).toBe("BDI");
      expect(element).toHaveAttribute("dir", "auto");
    }
    expect(body().getByText("+201001234567")).toHaveAttribute("dir", "ltr");
    expect(body().getByText("العربية")).toBeInTheDocument();
  });

  it("shows 'Not set' for a customer with no phone or language, and a Guest badge", () => {
    render(
      <CustomerOverviewCard
        customer={{ ...customer, phone: null, language: null, isGuest: true }}
        canEdit={false}
        t={en}
      />,
    );

    expect(body().getAllByText("Not set")).toHaveLength(2);
    expect(body().getByText("Guest")).toBeInTheDocument();
  });

  it("a viewer (canEdit false) has no Edit control, anywhere", () => {
    render(<CustomerOverviewCard customer={customer} canEdit={false} t={en} />);

    expect(body().queryByRole("button", { name: "Edit" })).toBeNull();
    expect(body().queryByRole("button")).toBeNull();
    expect(body().queryByRole("dialog")).toBeNull();
  });

  it("an operator opens a dialog with a title, a description and focus on Name; the email is read-only with its note", async () => {
    render(<CustomerOverviewCard customer={customer} canEdit t={en} />);

    fireEvent.click(body().getByRole("button", { name: "Edit" }));

    const dialog = await body().findByRole("dialog", { name: "Edit customer" });
    expect(dialog).toHaveAccessibleDescription(
      "Change this customer's name, phone number or language.",
    );
    await waitFor(() => expect(within(dialog).getByLabelText("Name")).toHaveFocus());
    const email = within(dialog).getByLabelText("Email");
    expect(email).toHaveAttribute("readonly");
    expect(email).not.toHaveAttribute("name");
    expect(email).toHaveValue("nour@example.com");
    expect(email).toHaveAccessibleDescription("Email can't be changed yet");
    expect(within(dialog).getByLabelText("Phone number")).toHaveValue("+201001234567");
    expect(within(dialog).getByLabelText("Language")).toHaveValue("ar");
  });

  it("Escape closes it and focus returns to the Edit trigger, which stayed mounted", async () => {
    render(<CustomerOverviewCard customer={customer} canEdit t={en} />);
    const trigger = body().getByRole("button", { name: "Edit" });
    fireEvent.click(trigger);
    const dialog = await body().findByRole("dialog", { name: "Edit customer" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(trigger).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("Cancel closes it, focus returns to the trigger, and reopening starts from the saved values", async () => {
    render(<CustomerOverviewCard customer={customer} canEdit t={en} />);
    const trigger = body().getByRole("button", { name: "Edit" });
    fireEvent.click(trigger);
    const first = await body().findByRole("dialog", { name: "Edit customer" });
    fireEvent.change(within(first).getByLabelText("Name"), { target: { value: "Changed" } });

    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    const second = await body().findByRole("dialog", { name: "Edit customer" });
    expect(within(second).getByLabelText("Name")).toHaveValue("Nour Hassan");
    expect(actions.updateCustomerProfileAction).not.toHaveBeenCalled();
  });

  it("Save sends the bound customer id and the form to the action, then closes and returns focus", async () => {
    actions.updateCustomerProfileAction.mockResolvedValue(OK);
    render(<CustomerOverviewCard customer={customer} canEdit t={en} />);
    const trigger = body().getByRole("button", { name: "Edit" });
    fireEvent.click(trigger);
    const dialog = await body().findByRole("dialog", { name: "Edit customer" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Nour H." } });
    fireEvent.change(within(dialog).getByLabelText("Phone number"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Language"), { target: { value: "" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.updateCustomerProfileAction).toHaveBeenCalledTimes(1));
    const [id, , data] = actions.updateCustomerProfileAction.mock.calls[0] as [
      string,
      unknown,
      FormData,
    ];
    expect(id).toBe(ID);
    expect(data.get("name")).toBe("Nour H.");
    expect(data.get("phone")).toBe("");
    expect(data.get("language")).toBe("");
    expect(data.has("email")).toBe(false);
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("a 422 shows the message under its field, keeps the dialog open and what was typed", async () => {
    actions.updateCustomerProfileAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { phone: "Enter a valid phone number" },
    });
    render(<CustomerOverviewCard customer={customer} canEdit t={en} />);
    fireEvent.click(body().getByRole("button", { name: "Edit" }));
    const dialog = await body().findByRole("dialog", { name: "Edit customer" });
    fireEvent.change(within(dialog).getByLabelText("Phone number"), { target: { value: "12" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Enter a valid phone number")).toBeVisible();
    expect(within(dialog).getByLabelText("Phone number")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByLabelText("Phone number")).toHaveValue("12");
    expect(body().getByRole("dialog", { name: "Edit customer" })).toBeInTheDocument();
  });

  it("an error with no field is an alert inside the dialog", async () => {
    actions.updateCustomerProfileAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    render(<CustomerOverviewCard customer={customer} canEdit t={en} />);
    fireEvent.click(body().getByRole("button", { name: "Edit" }));
    const dialog = await body().findByRole("dialog", { name: "Edit customer" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(en.formErrors.forbidden);
  });

  it("renders in Arabic from the Arabic dictionary", async () => {
    render(<CustomerOverviewCard customer={customer} canEdit t={ar} />);

    expect(body().getByText(ar.customerDetail.overview.title)).toBeInTheDocument();
    expect(body().getByText(ar.customerDetail.overview.phone)).toBeInTheDocument();
    fireEvent.click(body().getByRole("button", { name: ar.customerDetail.overview.edit }));
    const dialog = await body().findByRole("dialog", { name: ar.customerForm.editTitle });
    expect(dialog).toHaveAccessibleDescription(ar.customerForm.editDescription);
    expect(within(dialog).getByText(ar.customerForm.emailReadOnly)).toBeVisible();
    expect(within(dialog).queryByText(en.customerForm.emailReadOnly)).toBeNull();
  });
});

describe("CustomerNoteCard", () => {
  it("shows the note inside bdi, preserving line breaks", () => {
    render(
      <CustomerNoteCard customerId={ID} note={"Prefers calls\nNo SMS"} canEdit={false} t={en} />,
    );

    const note = body().getByText(/Prefers calls/);
    expect(note.tagName).toBe("BDI");
    expect(note).toHaveAttribute("dir", "auto");
    expect(note.parentElement).toHaveClass("whitespace-pre-wrap");
  });

  it("shows an empty state when there is no note", () => {
    render(<CustomerNoteCard customerId={ID} note={null} canEdit={false} t={en} />);

    expect(body().getByText("No notes yet.")).toBeInTheDocument();
  });

  it("a viewer has no Edit button and no dialog", () => {
    render(<CustomerNoteCard customerId={ID} note="x" canEdit={false} t={en} />);

    expect(body().queryByRole("button")).toBeNull();
    expect(body().queryByRole("dialog")).toBeNull();
  });

  it("an operator edits the note in a dialog: focus on the textarea, Escape restores focus to the trigger", async () => {
    render(<CustomerNoteCard customerId={ID} note="VIP" canEdit t={en} />);
    const trigger = body().getByRole("button", { name: "Edit" });
    fireEvent.click(trigger);

    const dialog = await body().findByRole("dialog", { name: "Edit notes" });
    expect(dialog).toHaveAccessibleDescription("Add a note about this customer.");
    await waitFor(() => expect(within(dialog).getByLabelText("Notes")).toHaveFocus());
    expect(within(dialog).getByLabelText("Notes")).toHaveValue("VIP");
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(trigger).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("Save sends the bound id and the note; an emptied note is sent empty (the action clears it)", async () => {
    actions.setCustomerNoteAction.mockResolvedValue(OK);
    render(<CustomerNoteCard customerId={ID} note="VIP" canEdit t={en} />);
    fireEvent.click(body().getByRole("button", { name: "Edit" }));
    const dialog = await body().findByRole("dialog", { name: "Edit notes" });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.setCustomerNoteAction).toHaveBeenCalledTimes(1));
    const [id, , data] = actions.setCustomerNoteAction.mock.calls[0] as [string, unknown, FormData];
    expect(id).toBe(ID);
    expect(data.get("note")).toBe("");
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
  });

  it("a refusal stays in the open dialog", async () => {
    actions.setCustomerNoteAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { note: "A note can be at most 5000 characters" },
    });
    render(<CustomerNoteCard customerId={ID} note={null} canEdit t={en} />);
    fireEvent.click(body().getByRole("button", { name: "Edit" }));
    const dialog = await body().findByRole("dialog", { name: "Edit notes" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("A note can be at most 5000 characters")).toBeVisible();
    expect(within(dialog).getByLabelText("Notes")).toHaveAttribute("aria-invalid", "true");
  });

  it("renders in Arabic", () => {
    render(<CustomerNoteCard customerId={ID} note={null} canEdit t={ar} />);

    expect(body().getByText(ar.customerDetail.notes.empty)).toBeInTheDocument();
    expect(body().getByRole("button", { name: ar.customerDetail.notes.edit })).toBeVisible();
  });
});

describe("CustomerTagsCard", () => {
  it("shows tags as chips in bdi; a viewer has no input, no remove buttons and no Save", () => {
    render(<CustomerTagsCard customerId={ID} tags={["VIP", "عميل"]} canEdit={false} t={en} />);

    for (const text of ["VIP", "عميل"]) {
      const chip = body().getByText(text);
      expect(chip.tagName).toBe("BDI");
      expect(chip).toHaveAttribute("dir", "auto");
    }
    expect(body().queryByRole("textbox")).toBeNull();
    expect(body().queryByRole("button")).toBeNull();
  });

  it("a viewer with no tags sees the empty text", () => {
    render(<CustomerTagsCard customerId={ID} tags={[]} canEdit={false} t={en} />);

    expect(body().getByText("No tags yet.")).toBeInTheDocument();
  });

  it("an operator removes and adds chips, and Save replaces the whole set", async () => {
    actions.setCustomerTagsAction.mockResolvedValue(OK);
    render(<CustomerTagsCard customerId={ID} tags={["Cairo", "VIP"]} canEdit t={en} />);
    const save = body().getByRole("button", { name: "Save tags" });
    expect(save).toBeDisabled();

    fireEvent.click(body().getByRole("button", { name: "Remove tag Cairo" }));
    fireEvent.change(body().getByLabelText("Add tags"), { target: { value: "gold, vip," } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(actions.setCustomerTagsAction).toHaveBeenCalledTimes(1));
    expect(actions.setCustomerTagsAction).toHaveBeenCalledWith(ID, ["VIP", "gold"]);
    expect(await body().findByRole("status")).toHaveTextContent("Tags saved.");
  });

  it("text still in the box is saved too", async () => {
    actions.setCustomerTagsAction.mockResolvedValue(OK);
    render(<CustomerTagsCard customerId={ID} tags={["VIP"]} canEdit t={en} />);

    fireEvent.change(body().getByLabelText("Add tags"), { target: { value: "Giza" } });
    fireEvent.click(body().getByRole("button", { name: "Save tags" }));

    await waitFor(() =>
      expect(actions.setCustomerTagsAction).toHaveBeenCalledWith(ID, ["VIP", "Giza"]),
    );
  });

  it("removing every chip saves an empty set", async () => {
    actions.setCustomerTagsAction.mockResolvedValue(OK);
    render(<CustomerTagsCard customerId={ID} tags={["VIP"]} canEdit t={en} />);

    fireEvent.click(body().getByRole("button", { name: "Remove tag VIP" }));
    fireEvent.click(body().getByRole("button", { name: "Save tags" }));

    await waitFor(() => expect(actions.setCustomerTagsAction).toHaveBeenCalledWith(ID, []));
  });

  it("a refusal shows its message and keeps the draft", async () => {
    actions.setCustomerTagsAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { tags: "A tag can be at most 40 characters" },
    });
    render(<CustomerTagsCard customerId={ID} tags={["VIP"]} canEdit t={en} />);
    fireEvent.change(body().getByLabelText("Add tags"), { target: { value: "x," } });

    fireEvent.click(body().getByRole("button", { name: "Save tags" }));

    expect(await body().findByRole("alert")).toHaveTextContent(
      "A tag can be at most 40 characters",
    );
    expect(body().getByText("x")).toBeInTheDocument();
    expect(body().queryByRole("status")).toBeNull();
  });

  it.each([
    ["extra internal spaces", "new  tag", ["new tag"]],
    ["an NFC-equivalent spelling", "café", ["café"]],
  ])(
    "%s of a saved tag is one canonical chip, and Save is disabled after the refresh",
    async (_label, typed, existing) => {
      actions.setCustomerTagsAction.mockResolvedValue(OK);
      const stored = [...existing, "gold"];
      const { rerender } = render(
        <CustomerTagsCard customerId={ID} tags={existing} canEdit t={en} />,
      );
      fireEvent.change(body().getByLabelText("Add tags"), {
        target: { value: `${typed}, gold,` },
      });
      fireEvent.click(body().getByRole("button", { name: "Save tags" }));

      await waitFor(() => expect(actions.setCustomerTagsAction).toHaveBeenCalledWith(ID, stored));
      // Sync point: the card's own status note, then the button leaving its "Saving…" state, so the
      // refreshed props below land on a settled card instead of racing the action's continuation.
      expect(await body().findByRole("status")).toHaveTextContent("Tags saved.");
      await body().findByRole("button", { name: "Save tags" });
      rerender(<CustomerTagsCard customerId={ID} tags={stored} canEdit t={en} />);

      await waitFor(
        () => {
          const chips = within(body().getByRole("list", { name: en.customerForm.tagsAdded }));
          expect(chips.getAllByRole("listitem").map((item) => item.textContent?.trim())).toEqual(
            stored,
          );
        },
        { timeout: 5000 },
      );
      await waitFor(
        () => expect(body().getByRole("button", { name: "Save tags" })).toBeDisabled(),
        { timeout: 5000 },
      );
    },
  );

  it("a changed canonical set that arrives before the action resolves is not overwritten", async () => {
    let resolveAction: (value: typeof OK) => void = () => undefined;
    actions.setCustomerTagsAction.mockReturnValue(
      new Promise<typeof OK>((resolve) => {
        resolveAction = resolve;
      }),
    );
    const { rerender } = render(<CustomerTagsCard customerId={ID} tags={["a"]} canEdit t={en} />);
    fireEvent.change(body().getByLabelText("Add tags"), { target: { value: "b," } });
    fireEvent.click(body().getByRole("button", { name: "Save tags" }));
    await waitFor(() => expect(actions.setCustomerTagsAction).toHaveBeenCalledWith(ID, ["a", "b"]));

    rerender(<CustomerTagsCard customerId={ID} tags={["a", "z"]} canEdit t={en} />);
    resolveAction(OK);

    expect(await body().findByRole("status")).toHaveTextContent("Tags saved.");
    await waitFor(() => {
      const chips = within(body().getByRole("list", { name: en.customerForm.tagsAdded }));
      expect(chips.getAllByRole("listitem").map((item) => item.textContent?.trim())).toEqual([
        "a",
        "z",
      ]);
    });
    await waitFor(() => expect(body().getByRole("button", { name: "Save tags" })).toBeDisabled());
  });

  it("starts the draft again from the stored tags the page re-renders with", async () => {
    const { rerender } = render(<CustomerTagsCard customerId={ID} tags={["a"]} canEdit t={en} />);
    fireEvent.change(body().getByLabelText("Add tags"), { target: { value: "b," } });
    expect(body().getByText("b")).toBeInTheDocument();

    rerender(<CustomerTagsCard customerId={ID} tags={["a", "z"]} canEdit t={en} />);

    await waitFor(() => expect(body().queryByText("b")).toBeNull());
    expect(await body().findByText("z")).toBeInTheDocument();
  });

  it("renders in Arabic", () => {
    render(<CustomerTagsCard customerId={ID} tags={["VIP"]} canEdit t={ar} />);

    expect(body().getByText(ar.customerDetail.tagsCard.title)).toBeInTheDocument();
    expect(body().getByRole("button", { name: ar.customerDetail.tagsCard.save })).toBeVisible();
    expect(
      body().getByRole("button", { name: ar.customerForm.removeTag.replace("{tag}", "VIP") }),
    ).toBeVisible();
  });
});

describe("CustomerMarketingCard", () => {
  it("a viewer sees read-only text and no toggles", () => {
    render(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: true, sms: false }}
        canEdit={false}
        t={en}
      />,
    );

    expect(body().getByText("Email subscribed")).toBeInTheDocument();
    expect(body().getByText("Not subscribed")).toBeInTheDocument();
    expect(body().queryByRole("switch")).toBeNull();
    expect(body().queryByRole("button")).toBeNull();
  });

  it("an operator gets one switch per channel, reflecting the recorded state", () => {
    render(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: false, sms: true }}
        canEdit
        t={en}
      />,
    );

    expect(body().getByRole("switch", { name: "Email marketing" })).not.toBeChecked();
    expect(body().getByRole("switch", { name: "SMS marketing" })).toBeChecked();
    expect(body().getByText("SMS subscribed")).toBeInTheDocument();
  });

  it("toggling a channel records only that channel", async () => {
    actions.changeMarketingConsentAction.mockResolvedValue(OK);
    render(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: false, sms: false }}
        canEdit
        t={en}
      />,
    );

    fireEvent.click(body().getByRole("switch", { name: "Email marketing" }));

    await waitFor(() =>
      expect(actions.changeMarketingConsentAction).toHaveBeenCalledWith(ID, "email", true),
    );
    expect(actions.changeMarketingConsentAction).toHaveBeenCalledTimes(1);
    expect(body().getByRole("switch", { name: "Email marketing" })).toBeChecked();
    expect(body().getByText("Email subscribed")).toBeInTheDocument();
    await waitFor(() =>
      expect(body().getByRole("switch", { name: "SMS marketing" })).toBeEnabled(),
    );
  });

  it("switching SMS off sends sms false", async () => {
    actions.changeMarketingConsentAction.mockResolvedValue(OK);
    render(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: true, sms: true }}
        canEdit
        t={en}
      />,
    );

    fireEvent.click(body().getByRole("switch", { name: "SMS marketing" }));

    await waitFor(() =>
      expect(actions.changeMarketingConsentAction).toHaveBeenCalledWith(ID, "sms", false),
    );
  });

  it("a refused change puts the switch back and says why", async () => {
    actions.changeMarketingConsentAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    render(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: false, sms: false }}
        canEdit
        t={en}
      />,
    );

    fireEvent.click(body().getByRole("switch", { name: "Email marketing" }));

    expect(await body().findByRole("alert")).toHaveTextContent(en.formErrors.forbidden);
    expect(body().getByRole("switch", { name: "Email marketing" })).not.toBeChecked();
    expect(body().getByText("Email marketing").closest("div")).not.toHaveTextContent(
      "Email subscribed",
    );
  });

  it("follows the state the page re-renders with", async () => {
    const { rerender } = render(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: false, sms: false }}
        canEdit
        t={en}
      />,
    );

    rerender(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: true, sms: false }}
        canEdit
        t={en}
      />,
    );

    await waitFor(() =>
      expect(body().getByRole("switch", { name: "Email marketing" })).toBeChecked(),
    );
  });

  it("says the switches record what staff enter, and makes no compliance claim", () => {
    render(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: false, sms: false }}
        canEdit
        t={en}
      />,
    );

    expect(body().getByText(en.customerDetail.marketing.note)).toBeVisible();
    expect(document.body.textContent ?? "").not.toMatch(/complian|GDPR|legal|verified consent/i);
  });

  it("renders in Arabic", () => {
    render(
      <CustomerMarketingCard
        customerId={ID}
        marketing={{ email: true, sms: false }}
        canEdit
        t={ar}
      />,
    );

    expect(body().getByText(ar.customerDetail.marketing.title)).toBeInTheDocument();
    expect(
      body().getByRole("switch", { name: ar.customerDetail.marketing.emailLabel }),
    ).toBeChecked();
    expect(body().getByText(ar.customerDetail.marketing.emailSubscribed)).toBeInTheDocument();
    expect(body().getByText(ar.customerDetail.marketing.notSubscribed)).toBeInTheDocument();
  });
});
