import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WhatsAppTemplateRowDto } from "@/lib/api/outreach";
import { en } from "@/messages/en";
import { TemplateForm } from "./template-form";
import { TemplatePreview } from "./template-preview";
import { TemplatesTable } from "./templates-table";

/**
 * A6 sweep: EVERY text node on the templates screens that names a brand (`WhatsApp`, `Meta`) sits in its own
 * `<bdi dir="auto">`, in the idle state and in each state that adds copy (dialog, alerts, results). One sweep over
 * `document.body` (the Dialog is portalled) instead of one assertion per string, so a new string can't slip by.
 */

const actions = vi.hoisted(() => ({
  createTemplateAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
  syncTemplatesAction: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/app/settings/whatsapp/templates/actions", () => ({
  createTemplateAction: actions.createTemplateAction,
  deleteTemplateAction: actions.deleteTemplateAction,
  syncTemplatesAction: actions.syncTemplatesAction,
}));
vi.mock("@/app/settings/whatsapp/actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: actions.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const BRAND = /\b(WhatsApp|Meta)\b/;

/** The text of every text node that names a brand without being the content of a `<bdi dir="auto">`. */
function bareBrandText(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const bare: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!BRAND.test(text)) continue;
    const parent = node.parentElement;
    const isolated = parent?.tagName === "BDI" && parent.getAttribute("dir") === "auto";
    if (!isolated) bare.push(text);
  }
  return bare;
}

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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  actions.createTemplateAction.mockReset().mockResolvedValue({ status: "success" });
  actions.deleteTemplateAction.mockReset().mockResolvedValue({ status: "success" });
  actions.syncTemplatesAction.mockReset().mockResolvedValue({ status: "success" });
});

describe("templates table: brand names are isolated", () => {
  it("the idle table, every rejection reason and the per-row copy", () => {
    expect.hasAssertions();
    const reasons = Object.keys(en.whatsappTemplates.reasons);
    render(
      <TemplatesTable
        t={en}
        rows={reasons.map((reason, index) =>
          row({ name: `t_${index}`, status: "REJECTED", rejectedReason: reason }),
        )}
      />,
    );
    // Open every rejection expander so its copy is in the DOM.
    for (const details of document.querySelectorAll("details")) details.setAttribute("open", "");
    expect(document.body.textContent).toContain("Meta");
    expect(bareBrandText()).toEqual([]);
  });

  it("the empty state", () => {
    expect.hasAssertions();
    render(<TemplatesTable t={en} rows={[]} />);
    expect(document.body.textContent).toContain("Meta");
    expect(bareBrandText()).toEqual([]);
  });

  it("the delete dialog, the sync notice and a refused write", async () => {
    expect.hasAssertions();
    actions.syncTemplatesAction.mockResolvedValueOnce({ status: "success" });
    render(<TemplatesTable t={en} rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: en.whatsappTemplates.sync }));
    expect((await screen.findByRole("status")).textContent).toBe(en.whatsappTemplates.synced);
    expect(bareBrandText()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("WhatsApp");
    expect(bareBrandText()).toEqual([]);
  });

  it("a sync that Meta cut short shows its copy with the brand isolated", async () => {
    expect.hasAssertions();
    actions.syncTemplatesAction.mockResolvedValue({
      status: "error",
      message: en.whatsappTemplates.errors.TEMPLATE_SYNC_INCOMPLETE,
    });
    render(<TemplatesTable t={en} rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: en.whatsappTemplates.sync }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Meta");
    expect(bareBrandText()).toEqual([]);
  });
});

describe("template form and preview: brand names are isolated", () => {
  it("the idle form and the preview", () => {
    expect.hasAssertions();
    render(<TemplateForm t={en} locale="en" />);
    expect(document.body.textContent).toContain("Meta");
    expect(bareBrandText()).toEqual([]);
  });

  it("the standalone preview, with and without content", () => {
    expect.hasAssertions();
    const filled = {
      header: "Order {{1}}",
      headerExample: "A12",
      body: "Hi {{1}}",
      examples: ["Sara"],
      footer: "Thanks",
      buttons: ["Track"],
    };
    const { rerender } = render(<TemplatePreview t={en} values={filled} />);
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(bareBrandText()).toEqual([]);
    rerender(
      <TemplatePreview
        t={en}
        values={{ ...filled, header: "", body: "", footer: "", buttons: [] }}
      />,
    );
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(bareBrandText()).toEqual([]);
  });

  it("a refused submission and a submitted template", async () => {
    expect.hasAssertions();
    actions.createTemplateAction.mockResolvedValueOnce({
      status: "refused",
      message: en.whatsappTemplates.errors.TEMPLATE_ALREADY_EXISTS,
    });
    render(<TemplateForm t={en} locale="en" />);
    fireEvent.change(screen.getByLabelText(en.whatsappTemplates.form.name), {
      target: { value: "order_update" },
    });
    fireEvent.change(screen.getByLabelText(en.whatsappTemplates.form.body), {
      target: { value: "Your order is on its way today." },
    });
    const submit = screen.getByRole("button", { name: en.whatsappTemplates.form.submit });
    fireEvent.click(submit);
    expect((await screen.findByRole("alert")).textContent).toBe(
      en.whatsappTemplates.errors.TEMPLATE_ALREADY_EXISTS,
    );
    expect(bareBrandText()).toEqual([]);

    actions.createTemplateAction.mockResolvedValueOnce({ status: "success" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: en.whatsappTemplates.form.submit })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: en.whatsappTemplates.form.submit }));
    await screen.findByText(/reviewing it/);
    expect(bareBrandText()).toEqual([]);
  });
});
