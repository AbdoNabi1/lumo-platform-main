import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WhatsAppTemplateRowDto } from "@/lib/api/outreach";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { TemplatesTable } from "./templates-table";

const actions = vi.hoisted(() => ({
  deleteTemplateAction: vi.fn(),
  syncTemplatesAction: vi.fn(),
}));
vi.mock("@/app/settings/whatsapp/templates/actions", () => actions);
vi.mock("@/app/settings/whatsapp/actions", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function row(overrides: Partial<WhatsAppTemplateRowDto> = {}): WhatsAppTemplateRowDto {
  return {
    name: "order_update",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    rejectedReason: null,
    variableCount: 0,
    supported: true,
    sendShape: { bodyVariableCount: 0, headerHasVariable: false, buttons: [] },
    ...overrides,
  };
}

const ROWS: readonly WhatsAppTemplateRowDto[] = [
  row(),
  row({ name: "summer_sale", language: "ar", category: "MARKETING", status: "PENDING" }),
  row({
    name: "flash_offer",
    language: "ar",
    category: "MARKETING",
    status: "REJECTED",
    rejectedReason: "INCORRECT_CATEGORY",
  }),
  row({ name: "old_one", status: "PAUSED" }),
  row({ name: "dead_one", status: "DISABLED" }),
];

function renderTable(rows: readonly WhatsAppTemplateRowDto[], t: Dictionary = en) {
  return render(<TemplatesTable rows={rows} t={t} />);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  actions.deleteTemplateAction.mockReset().mockResolvedValue({ status: "success" });
  actions.syncTemplatesAction.mockReset().mockResolvedValue({ status: "success" });
});

describe("templates table: the list", () => {
  it("shows name, language, category and a status badge per row, with the right colours", () => {
    expect.hasAssertions();
    renderTable(ROWS);
    const table = screen.getByRole("table", { name: en.whatsappTemplates.listLabel });
    const approved = within(table).getByText("Approved");
    const pending = within(table).getByText("Pending");
    const rejected = within(table).getByText("Rejected");
    expect(approved.className).toContain("success");
    expect(pending.className).toContain("warning");
    expect(rejected.className).toContain("destructive");
    expect(within(table).getByText("Paused")).toBeInTheDocument();
    expect(within(table).getByText("Disabled")).toBeInTheDocument();
    expect(within(table).getAllByText("Utility").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Marketing").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("English").length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/عربي/).length).toBeGreaterThan(0);
    expect(within(table).getByText("order_update")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(ROWS.length + 1);
  });

  it("keeps each template name in <bdi dir=ltr> and brand names in <bdi dir=auto>", () => {
    expect.hasAssertions();
    const view = renderTable(ROWS);
    const names = Array.from(view.container.querySelectorAll('bdi[dir="ltr"]')).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(expect.arrayContaining(["order_update", "summer_sale", "flash_offer"]));
    const brands = Array.from(view.container.querySelectorAll('bdi[dir="auto"]')).map(
      (el) => el.textContent,
    );
    expect(brands).toContain("Meta");
  });

  it("explains a rejection in an expander, mapped to copy and never the raw reason code", () => {
    expect.hasAssertions();
    const view = renderTable(ROWS);
    const toggle = screen.getByText(en.whatsappTemplates.reasonToggle);
    expect(toggle.closest("details")).toBeInTheDocument();
    expect(view.container.querySelectorAll("details")).toHaveLength(1);
    expect(document.body).toHaveTextContent(en.whatsappTemplates.reasons.INCORRECT_CATEGORY);
    expect(document.body).not.toHaveTextContent("INCORRECT_CATEGORY");
  });

  it("an unknown or missing rejection reason reads generic, never the raw value", () => {
    expect.hasAssertions();
    renderTable([
      row({ status: "REJECTED", rejectedReason: null }),
      row({ name: "b", status: "REJECTED", rejectedReason: "SOMETHING_NEW" }),
    ]);
    const generic = Array.from(document.querySelectorAll("details p")).filter(
      (p) => p.textContent === en.whatsappTemplates.reasons.other,
    );
    expect(generic).toHaveLength(2);
    expect(document.body).not.toHaveTextContent("SOMETHING_NEW");
  });

  it("an unknown status or category reads as a neutral generic label, never the raw value", () => {
    expect.hasAssertions();
    renderTable([row({ status: "WEIRD_STATE", category: "AUTHENTICATION", language: "fr" })]);
    expect(screen.getByText(en.whatsappTemplates.statuses.other)).toBeInTheDocument();
    expect(screen.getByText(en.whatsappTemplates.categories.other)).toBeInTheDocument();
    expect(screen.getByText(en.whatsappTemplates.languages.other)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("WEIRD_STATE");
    expect(document.body).not.toHaveTextContent("AUTHENTICATION");
  });

  it("hides deleted and archived templates", () => {
    expect.hasAssertions();
    renderTable([
      row(),
      row({ name: "gone", status: "DELETED" }),
      row({ name: "old", status: "ARCHIVED" }),
    ]);
    expect(screen.queryByText("gone")).toBeNull();
    expect(screen.queryByText("old")).toBeNull();
    expect(screen.getByText("order_update")).toBeInTheDocument();
  });

  it("empty state explains that Meta's approval takes minutes to 24 hours, and still offers the actions", () => {
    expect.hasAssertions();
    renderTable([]);
    expect(screen.getByText(en.whatsappTemplates.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("24 hours");
    expect(screen.getByRole("note")).toHaveTextContent("few minutes");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: /Sync from Meta/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New template/ })).toHaveAttribute(
      "href",
      "/settings/whatsapp/templates/new",
    );
  });

  it("renders Arabic copy with its own labels", () => {
    expect.hasAssertions();
    renderTable(ROWS, ar);
    expect(screen.getByRole("table", { name: ar.whatsappTemplates.listLabel })).toBeInTheDocument();
    expect(screen.getByText(ar.whatsappTemplates.statuses.APPROVED)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: ar.whatsappTemplates.newTemplate }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Approved");
  });
});

describe("Sync from Meta", () => {
  it("calls the action once and says so, then is available again", async () => {
    expect.hasAssertions();
    renderTable(ROWS);
    fireEvent.click(screen.getByRole("button", { name: /Sync from Meta/ }));
    await waitFor(() => expect(actions.syncTemplatesAction).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent(en.whatsappTemplates.synced);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sync from Meta/ })).toBeEnabled(),
    );
  });

  it("disables the button while syncing (no overlapping syncs)", async () => {
    expect.hasAssertions();
    let release!: (value: { status: "success" }) => void;
    actions.syncTemplatesAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderTable(ROWS);
    fireEvent.click(screen.getByRole("button", { name: /Sync from Meta/ }));
    const busy = await screen.findByRole("button", { name: /Syncing/ });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(actions.syncTemplatesAction).toHaveBeenCalledTimes(1);
    release({ status: "success" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sync from Meta/ })).toBeEnabled(),
    );
  });

  it("shows the mapped error as an alert", async () => {
    expect.hasAssertions();
    actions.syncTemplatesAction.mockResolvedValue({
      status: "error",
      message: en.whatsappTemplates.errors.TEMPLATE_SYNC_INCOMPLETE,
    });
    renderTable(ROWS);
    fireEvent.click(screen.getByRole("button", { name: /Sync from Meta/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappTemplates.errors.TEMPLATE_SYNC_INCOMPLETE,
    );
  });
});

/** The dialog's description text (the accessible-name algorithm pads inline islands with spaces; the DOM text is exact). */
function descriptionOf(dialog: HTMLElement): string | null {
  const id = dialog.getAttribute("aria-describedby");
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
}

describe("delete Dialog (A7, B11)", () => {
  function deleteTrigger(name: string) {
    return screen.getByRole("button", { name: `Delete ${name}` });
  }

  it("has a title and the every-language / 30-day description, focuses Cancel and names the template", () => {
    expect.hasAssertions();
    renderTable(ROWS);
    fireEvent.click(deleteTrigger("order_update"));
    const dialog = screen.getByRole("dialog", { name: en.whatsappTemplates.deleteTitle });
    expect(descriptionOf(dialog)).toBe(
      `This deletes "order_update" in every language on your WhatsApp account. You can't reuse this name for 30 days.`,
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(dialog.querySelector('bdi[dir="ltr"]')).toHaveTextContent("order_update");
    expect(dialog.querySelector('bdi[dir="auto"]')).toHaveTextContent("WhatsApp");
  });

  it("Escape closes it, nothing is deleted, and focus returns to the same trigger, still mounted", async () => {
    expect.hasAssertions();
    renderTable(ROWS);
    const trigger = deleteTrigger("order_update");
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.deleteTemplateAction).not.toHaveBeenCalled();
    expect(deleteTrigger("order_update")).toBe(trigger);
    expect(trigger).toHaveFocus();
  });

  it("Cancel closes it without deleting and returns focus to the trigger", async () => {
    expect.hasAssertions();
    renderTable(ROWS);
    const trigger = deleteTrigger("order_update");
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.deleteTemplateAction).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("deletes by name once, then keeps the trigger mounted and focused across the refreshed list", async () => {
    expect.hasAssertions();
    let release!: (value: { status: "success" }) => void;
    actions.deleteTemplateAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = renderTable(ROWS);
    const trigger = deleteTrigger("order_update");
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(actions.deleteTemplateAction).toHaveBeenCalledTimes(1));
    expect(actions.deleteTemplateAction).toHaveBeenCalledWith("order_update");
    // The server action revalidated: the live list no longer has the template.
    view.rerender(<TemplatesTable rows={ROWS.slice(1)} t={en} />);
    expect(trigger).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    release({ status: "success" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole("status")).toHaveTextContent(en.whatsappTemplates.deleted);
    // Once focus moves on, the deleted row goes.
    trigger.blur();
    await waitFor(() => expect(screen.queryByText("order_update")).toBeNull());
    expect(screen.getByText("summer_sale")).toBeInTheDocument();
  });

  it("deleting the last template keeps its trigger until focus moves, then shows the empty state", async () => {
    expect.hasAssertions();
    const only = [row()];
    const view = renderTable(only);
    const trigger = deleteTrigger("order_update");
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(actions.deleteTemplateAction).toHaveBeenCalledTimes(1));
    view.rerender(<TemplatesTable rows={[]} t={en} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    trigger.blur();
    expect(await screen.findByText(en.whatsappTemplates.emptyTitle)).toBeInTheDocument();
  });

  it("Escape while the delete is unresolved dismisses the dialog without duplicating it", async () => {
    expect.hasAssertions();
    let release!: (value: { status: "success" }) => void;
    actions.deleteTemplateAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderTable(ROWS);
    const trigger = deleteTrigger("order_update");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
    ).toBeDisabled();
    expect(actions.deleteTemplateAction).toHaveBeenCalledTimes(1);
    release({ status: "success" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a refused delete as an alert with the mapped copy and keeps the row", async () => {
    expect.hasAssertions();
    actions.deleteTemplateAction.mockResolvedValue({
      status: "error",
      message: en.whatsappSettings.errors.WHATSAPP_NOT_CONNECTED,
    });
    renderTable(ROWS);
    fireEvent.click(deleteTrigger("order_update"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappSettings.errors.WHATSAPP_NOT_CONNECTED,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("order_update")).toBeInTheDocument();
  });

  it("Arabic dialog keeps the name in an LTR island inside the Arabic sentence", () => {
    expect.hasAssertions();
    renderTable(ROWS, ar);
    fireEvent.click(
      screen.getByRole("button", { name: `${ar.whatsappTemplates.delete} order_update` }),
    );
    const dialog = screen.getByRole("dialog", { name: ar.whatsappTemplates.deleteTitle });
    expect(descriptionOf(dialog)).toBe(
      ar.whatsappTemplates.deleteDescription.replace("{name}", "order_update"),
    );
    expect(dialog.querySelector('bdi[dir="ltr"]')).toHaveTextContent("order_update");
  });
});

describe("non-disclosure", () => {
  it("never renders the raw Meta components, ids or reason codes in document.body", () => {
    expect.hasAssertions();
    const leaky = {
      ...row({ status: "REJECTED", rejectedReason: "SCAM" }),
      components: [{ type: "BODY", text: "SECRET_BODY" }],
      metaTemplateId: "123456789",
      wabaId: "987654321",
    } as unknown as WhatsAppTemplateRowDto;
    renderTable([leaky]);
    expect(document.body).not.toHaveTextContent("SECRET_BODY");
    expect(document.body).not.toHaveTextContent("123456789");
    expect(document.body).not.toHaveTextContent("987654321");
    expect(document.body).not.toHaveTextContent("SCAM");
  });
});
