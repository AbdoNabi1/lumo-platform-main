import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";

const issueRecoveryLinkAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/abandoned-checkouts/actions", () => ({ issueRecoveryLinkAction }));

const { RecoveryCard } = await import("./recovery-card");

const r = en.abandonedCheckouts.recovery;
const URL = "https://www.sara.shop/c/tok";

function renderCard(overrides: Partial<Parameters<typeof RecoveryCard>[0]> = {}) {
  return render(
    <RecoveryCard
      checkoutId="cs-1"
      customerName="Mona"
      phone="01001234567"
      country="EG"
      canRecover
      t={en}
      {...overrides}
    />,
  );
}

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
  });
}

beforeEach(() => {
  issueRecoveryLinkAction.mockResolvedValue({ ok: true, url: URL, shopName: "Sara Shop" });
});

afterEach(() => {
  vi.restoreAllMocks();
  issueRecoveryLinkAction.mockReset();
});

describe("RecoveryCard (order operations Part 3)", () => {
  it("copies a fresh link, shows it, and says Copied", async () => {
    stubClipboard(async () => undefined);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(await screen.findByRole("button", { name: r.copied })).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(URL);
    expect(screen.getByLabelText(r.linkLabel)).toHaveValue(URL);
    expect(issueRecoveryLinkAction).toHaveBeenCalledWith("cs-1");
  });

  it("shows the link when the clipboard is refused, and never says Copied (Review Focus 3)", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(await screen.findByLabelText(r.linkLabel)).toHaveValue(URL);
    expect(screen.queryByRole("button", { name: r.copied })).toBeNull();
    expect(screen.getByRole("button", { name: r.copy })).toBeInTheDocument();
  });

  it("shares on WhatsApp with an editable message, to the customer's own chat", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.whatsapp }));
    const message = (await screen.findByLabelText(r.messageLabel)) as HTMLTextAreaElement;
    expect(message.value).toBe(
      "Hi Mona, we noticed you didn't finish your order from Sara Shop. You can complete it here: " +
        URL,
    );
    fireEvent.change(message, { target: { value: `Mona, here: ${URL}` } });
    fireEvent.click(screen.getByRole("button", { name: r.openWhatsApp }));
    expect(open).toHaveBeenCalledWith(
      `https://wa.me/201001234567?text=${encodeURIComponent(`Mona, here: ${URL}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("without a name or a usable phone: the nameless greeting and WhatsApp's chat picker", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderCard({ customerName: null, phone: null });
    fireEvent.click(screen.getByRole("button", { name: r.whatsapp }));
    const message = (await screen.findByLabelText(r.messageLabel)) as HTMLTextAreaElement;
    expect(message.value.startsWith("Hi, we noticed")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: r.openWhatsApp }));
    expect(open.mock.calls[0]?.[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("shows the server's refusal and no link", async () => {
    issueRecoveryLinkAction.mockResolvedValue({ ok: false, message: r.forbidden });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(await screen.findByRole("alert")).toHaveTextContent(r.forbidden);
    expect(screen.queryByLabelText(r.linkLabel)).toBeNull();
  });

  it("a viewer sees no recovery buttons, only the coming-soon note", async () => {
    renderCard({ canRecover: false });
    expect(screen.queryByRole("button", { name: r.copy })).toBeNull();
    expect(screen.queryByRole("button", { name: r.whatsapp })).toBeNull();
    await waitFor(() => expect(screen.getByText(r.comingSoon)).toBeInTheDocument());
  });
});
