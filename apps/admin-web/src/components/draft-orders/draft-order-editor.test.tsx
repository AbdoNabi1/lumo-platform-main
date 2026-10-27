import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DraftOrderDto } from "@/lib/api/draft-orders";
import { formatCurrency } from "@/lib/format";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  saveDraftOrderAction: vi.fn(),
  sendDraftInvoiceAction: vi.fn(),
  completeDraftOrderAction: vi.fn(),
  deleteDraftOrderAction: vi.fn(),
  draftShippingRatesAction: vi.fn(),
  searchDraftProductsAction: vi.fn(),
  draftProductVariantsAction: vi.fn(),
  searchDraftCustomersAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/draft-orders/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { DraftOrderEditor } = await import("./draft-order-editor");

const { saveDraftOrderAction, sendDraftInvoiceAction, completeDraftOrderAction } = actions;
const p = en.draftOrders.editor.payment;

const DTO: DraftOrderDto = {
  id: "01920000-0000-7000-8000-00000000d003",
  draftNumber: "D3",
  status: "open",
  version: 2,
  currency: "EGP",
  createdAt: "2026-10-25T10:00:00.000Z",
  updatedAt: "2026-10-25T10:00:00.000Z",
  invoiceSentAt: null,
  completedAt: null,
  customer: null,
  email: "sara@example.com",
  phone: "01001234567",
  shippingAddress: {
    name: "Mona Ali",
    phone: "01001234567",
    line1: "5 Nile St",
    line2: null,
    city: "Cairo",
    province: "EG-C",
    postalCode: "",
    country: "EG",
  },
  billingAddress: null,
  lines: [
    {
      productId: "p-1",
      variantId: "v-1",
      sku: "TEE",
      title: "Tee",
      variantTitle: "M",
      quantity: 2,
      unitPriceMinor: 25000,
      lineTotalMinor: 50000,
      imageUrl: null,
    },
  ],
  discount: { valueType: "fixed", value: 5000, reason: "Loyal", amountMinor: 5000 },
  shipping: { kind: "rate", method: "standard", title: "Standard", amountMinor: 500 },
  note: "call first",
  tags: ["vip"],
  totals: {
    subtotalMinor: 50000,
    discountMinor: 5000,
    shippingMinor: 500,
    taxMinor: 0,
    taxIncluded: true,
    totalMinor: 45500,
  },
  order: null,
  links: [],
  missing: { invoice: [], complete: [] },
};

const note = () => screen.getByLabelText("Note");
const typeNote = (value: string) => fireEvent.change(note(), { target: { value } });
const openCollect = async () => {
  fireEvent.keyDown(screen.getByRole("button", { name: p.collectPayment }), { key: "Enter" });
  return screen.findByRole("menu");
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of [...Object.values(actions), ...Object.values(router)]) fn.mockReset();
});

describe("DraftOrderEditor", () => {
  it("a new draft shows 'Create order', no save bar until something changes, and Save sends ids only", async () => {
    saveDraftOrderAction.mockResolvedValue({ ok: true, draft: DTO });
    render(<DraftOrderEditor draft={null} canEdit canMarkPaid={false} t={en} locale="en" />);
    expect(screen.getByRole("heading", { name: "Create order" })).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    typeNote("call first");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/draft-orders/${DTO.id}`));
    const [id, version, input] = saveDraftOrderAction.mock.calls[0] ?? [];
    expect([id, version]).toEqual([null, null]);
    expect(input).toMatchObject({ note: "call first", lines: [] });
    expect(JSON.stringify(input)).not.toMatch(/unitPrice|lineTotal/);
  });

  it("Discard returns to the saved draft", () => {
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("call first!");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(note()).toHaveValue("call first");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("shows the field errors and the message when a save is refused", async () => {
    saveDraftOrderAction.mockResolvedValue({
      ok: false,
      message: en.draftOrders.editor.errors.invalid,
      code: null,
      fields: { "lines.0": "this product can no longer be sold" },
      conflict: false,
    });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("x");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("this product can no longer be sold")).toBeInTheDocument();
    expect(screen.getByText(en.draftOrders.editor.errors.invalid)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a version conflict offers Reload, which takes the other person's draft", async () => {
    saveDraftOrderAction.mockResolvedValue({
      ok: false,
      message: en.draftOrders.editor.errors.conflict,
      code: "VERSION_CONFLICT",
      fields: {},
      conflict: true,
    });
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("mine");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const reloadButton = await screen.findByRole("button", { name: "Reload" });
    await waitFor(() => expect(reloadButton).toBeEnabled());
    fireEvent.click(reloadButton);
    expect(router.refresh).toHaveBeenCalled();
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, version: 3, note: "theirs" }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(note()).toHaveValue("theirs");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("a newer draft from the server never overwrites unsaved edits on its own", () => {
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("mine");
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, version: 3, note: "theirs" }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(note()).toHaveValue("mine");
  });

  it("Mark as paid is disabled for non-admins, with the reason (spec §4.9, Ruling 25)", async () => {
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid={false} t={en} locale="en" />);
    await openCollect();
    const item = screen.getByRole("menuitem", { name: /Mark as paid/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Only admins can mark an order as paid")).toBeInTheDocument();
    fireEvent.click(item);
    expect(completeDraftOrderAction).not.toHaveBeenCalled();
  });

  it("a viewer sees the draft read-only (no Save, no Send invoice)", () => {
    render(<DraftOrderEditor draft={DTO} canEdit={false} canMarkPaid={false} t={en} locale="en" />);
    expect(screen.queryByRole("button", { name: "Send invoice" })).toBeNull();
    expect(screen.queryByRole("button", { name: p.collectPayment })).toBeNull();
    expect(note()).toHaveAttribute("readonly");
  });

  it("a completed draft is read-only with a banner linking its order", () => {
    render(
      <DraftOrderEditor
        draft={{ ...DTO, status: "completed", order: { id: "o-1", orderNumber: "1001" } }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("This draft order was completed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View order #1001" })).toHaveAttribute(
      "href",
      "/orders/o-1",
    );
    expect(screen.queryByRole("button", { name: p.collectPayment })).toBeNull();
  });

  it("Send invoice saves first when there are unsaved changes (Pre-flight 10)", async () => {
    saveDraftOrderAction.mockResolvedValue({ ok: true, draft: DTO });
    sendDraftInvoiceAction.mockResolvedValue({ ok: true, url: "https://s/c/x", shopName: "Shop" });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("call first!");
    fireEvent.click(screen.getByRole("button", { name: "Send invoice" }));
    expect(await screen.findByDisplayValue("https://s/c/x")).toBeInTheDocument();
    expect(saveDraftOrderAction.mock.invocationCallOrder[0]).toBeLessThan(
      sendDraftInvoiceAction.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("Send invoice without changes issues the link without saving", async () => {
    sendDraftInvoiceAction.mockResolvedValue({ ok: true, url: "https://s/c/x", shopName: "Shop" });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Send invoice" }));
    expect(await screen.findByDisplayValue("https://s/c/x")).toBeInTheDocument();
    expect(saveDraftOrderAction).not.toHaveBeenCalled();
    expect(sendDraftInvoiceAction).toHaveBeenCalledWith(DTO.id);
  });

  it("Send invoice is single-flight: a second press while a link is made mints nothing", async () => {
    let finish: (value: unknown) => void = () => undefined;
    sendDraftInvoiceAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    const button = screen.getByRole("button", { name: "Send invoice" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => finish({ ok: true, url: "https://s/c/x", shopName: "Shop" }));
    expect(sendDraftInvoiceAction).toHaveBeenCalledTimes(1);
  });

  it("Mark as paid on a dirty form confirms the total the save produced (Pre-flight 11)", async () => {
    const after = { ...DTO, version: 3, totals: { ...DTO.totals, totalMinor: 99900 } };
    saveDraftOrderAction.mockResolvedValue({ ok: true, draft: after });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    typeNote("two more");
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.markAsPaid }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(
      p.confirmMarkAsPaid.replace("{total}", formatCurrency("en", 99900, "EGP")),
    );
    expect(saveDraftOrderAction.mock.invocationCallOrder[0]).toBeLessThan(
      confirm.mock.invocationCallOrder[0] ?? 0,
    );
    expect(completeDraftOrderAction).not.toHaveBeenCalled();
  });

  it("Collect on delivery creates the order and opens it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    completeDraftOrderAction.mockResolvedValue({ ok: true, orderId: "o-1" });
    render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid={false} t={en} locale="en" />);
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.collectOnDelivery }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/orders/o-1"));
    expect(completeDraftOrderAction).toHaveBeenCalledWith(DTO.id, "collect_on_delivery");
  });

  it("after PAYMENT_NOT_RECORDED, Try again repeats the same payment without asking again", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    completeDraftOrderAction.mockResolvedValueOnce({
      ok: false,
      message: "Order #1001 was created but the payment was not recorded — try again.",
      code: "PAYMENT_NOT_RECORDED",
    });
    completeDraftOrderAction.mockResolvedValueOnce({ ok: true, orderId: "o-1" });
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.markAsPaid }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Order #1001 was created");
    // The draft now reads completed (the order exists): the retry is still offered.
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, status: "completed", order: { id: "o-1", orderNumber: "1001" } }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("This draft order was completed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/orders/o-1"));
    expect(completeDraftOrderAction.mock.calls).toEqual([
      [DTO.id, "paid"],
      [DTO.id, "paid"],
    ]);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("after DRAFT_BUSY the draft is reloaded, and the next confirmation shows its new total", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    completeDraftOrderAction.mockResolvedValue({
      ok: false,
      message: en.draftOrders.editor.errors.busy,
      code: "DRAFT_BUSY",
    });
    const view = render(<DraftOrderEditor draft={DTO} canEdit canMarkPaid t={en} locale="en" />);
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.collectOnDelivery }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    view.rerender(
      <DraftOrderEditor
        draft={{ ...DTO, version: 4, totals: { ...DTO.totals, totalMinor: 70000 } }}
        canEdit
        canMarkPaid
        t={en}
        locale="en"
      />,
    );
    confirm.mockReturnValue(false);
    await openCollect();
    fireEvent.click(screen.getByRole("menuitem", { name: p.collectOnDelivery }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm).toHaveBeenLastCalledWith(
      p.confirmCollect.replace("{total}", formatCurrency("en", 70000, "EGP")),
    );
    expect(saveDraftOrderAction).not.toHaveBeenCalled();
  });
});
