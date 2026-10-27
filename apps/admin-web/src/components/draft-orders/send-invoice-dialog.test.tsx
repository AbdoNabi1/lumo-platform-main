import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EMPTY_DRAFT_ADDRESS, formFromDraft } from "@/lib/orders/draft-orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { SendInvoiceDialog } from "./send-invoice-dialog";

const URL = "https://www.sara.shop/c/tok";
const i = en.draftOrders.editor.invoice;

function renderDialog(overrides: Partial<Parameters<typeof SendInvoiceDialog>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <SendInvoiceDialog
      url={URL}
      shopName="Sara Shop"
      draftNumber="D3"
      total={45500}
      currency="EGP"
      form={{
        ...formFromDraft(null),
        phone: "01001234567",
        shippingAddress: { ...EMPTY_DRAFT_ADDRESS, name: "Mona", country: "EG" },
      }}
      onClose={onClose}
      t={en}
      locale="en"
      {...overrides}
    />,
  );
  return onClose;
}

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SendInvoiceDialog", () => {
  it("shows the new link read-only, left to right", () => {
    renderDialog();
    const field = screen.getByLabelText(i.linkLabel);
    expect(field).toHaveValue(URL);
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(i.expires)).toBeInTheDocument();
  });

  it("copies the link and says Copied only after a real copy", async () => {
    stubClipboard(async () => undefined);
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: i.copy }));
    expect(await screen.findByRole("button", { name: i.copied })).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(URL);
  });

  it("a refused clipboard leaves the link selected in its field and never says Copied", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: i.copy }));
    const field = screen.getByLabelText(i.linkLabel) as HTMLInputElement;
    await waitFor(() => expect(field).toHaveFocus());
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(URL.length);
    expect(screen.queryByRole("button", { name: i.copied })).toBeNull();
  });

  it("shares on WhatsApp to the customer's chat with the Egyptian Arabic message", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderDialog({ t: ar, locale: "ar" });
    const a = ar.draftOrders.editor.invoice;
    fireEvent.click(screen.getByRole("button", { name: a.whatsapp }));
    const message = screen.getByLabelText(a.messageLabel) as HTMLTextAreaElement;
    expect(message.value).toBe(
      `أهلاً Mona، دي فاتورة طلبك #D3 من Sara Shop بإجمالي ${new Intl.NumberFormat("ar", {
        style: "currency",
        currency: "EGP",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(455)}. تقدر تدفع من هنا: ${URL}`,
    );
    fireEvent.click(screen.getByRole("button", { name: a.openWhatsApp }));
    expect(open).toHaveBeenCalledWith(
      `https://wa.me/201001234567?text=${encodeURIComponent(message.value)}`,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("the merchant can edit the message before sending; no name, no phone → the chat picker", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderDialog({ form: formFromDraft(null) });
    fireEvent.click(screen.getByRole("button", { name: i.whatsapp }));
    const message = screen.getByLabelText(i.messageLabel) as HTMLTextAreaElement;
    expect(message.value.startsWith("Hi, here is the invoice")).toBe(true);
    fireEvent.change(message, { target: { value: `Pay here: ${URL}` } });
    fireEvent.click(screen.getByRole("button", { name: i.openWhatsApp }));
    expect(open).toHaveBeenCalledWith(
      `https://wa.me/?text=${encodeURIComponent(`Pay here: ${URL}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("offers email as coming soon, and Close closes", () => {
    const onClose = renderDialog();
    expect(screen.getByText(i.email)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: i.close })[0] as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });
});
