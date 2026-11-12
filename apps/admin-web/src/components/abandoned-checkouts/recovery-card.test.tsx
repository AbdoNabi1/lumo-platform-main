import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  configure,
  fireEvent,
  getConfig,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ar } from "@/messages/ar";
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

// Every wait here is on the card after a link is minted; on a slow CI runner that takes longer
// than Testing Library's 1s default (a WhatsApp message box was missed at ~1.1s).
let defaultAsyncTimeout = 1000;
beforeAll(() => {
  defaultAsyncTimeout = getConfig().asyncUtilTimeout;
  configure({ asyncUtilTimeout: 5000 });
});
afterAll(() => {
  configure({ asyncUtilTimeout: defaultAsyncTimeout });
});

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
      "Hi Mona, we noticed you didn't finish your order from Sara Shop. You can complete it here:\n" +
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

  it("a rejected server action shows the generic error instead of crashing the page", async () => {
    issueRecoveryLinkAction.mockRejectedValue(new Error("network"));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(await screen.findByRole("alert")).toHaveTextContent(r.error);
    expect(screen.queryByLabelText(r.linkLabel)).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: r.copy })).toBeEnabled());
  });

  it("a second press while a link is being made does not mint another", async () => {
    let finish: (value: unknown) => void = () => undefined;
    issueRecoveryLinkAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    stubClipboard(async () => undefined);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    fireEvent.click(screen.getByRole("button", { name: r.whatsapp }));
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(issueRecoveryLinkAction).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, url: URL, shopName: "Sara Shop" }));
    await screen.findByLabelText(r.linkLabel);
    expect(issueRecoveryLinkAction).toHaveBeenCalledTimes(1);
  });

  it("focuses and selects the link when the clipboard is refused", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    const field = (await screen.findByLabelText(r.linkLabel)) as HTMLInputElement;
    await waitFor(() => expect(field).toHaveFocus());
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(URL.length);
  });

  it("Copied goes back to Copy after a moment", async () => {
    stubClipboard(async () => undefined);
    const timers = vi.spyOn(globalThis, "setTimeout");
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    expect(await screen.findByRole("button", { name: r.copied })).toBeInTheDocument();
    const reset = timers.mock.calls.find(([, delay]) => delay === 3000)?.[0];
    expect(reset).toBeTypeOf("function");
    await act(async () => {
      (reset as () => void)();
    });
    expect(screen.getByRole("button", { name: r.copy })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: r.copied })).toBeNull();
  });

  it("sharing after a copy no longer says Copied (the clipboard holds an older link)", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    stubClipboard(async () => undefined);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: r.copy }));
    await screen.findByRole("button", { name: r.copied });
    fireEvent.click(screen.getByRole("button", { name: r.whatsapp }));
    await screen.findByLabelText(r.messageLabel);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: r.copied, hidden: true })).toBeNull(),
    );
  });

  it("writes the Arabic WhatsApp message, with the link on its own line", async () => {
    renderCard({ t: ar });
    const a = ar.abandonedCheckouts.recovery;
    fireEvent.click(screen.getByRole("button", { name: a.whatsapp }));
    const message = (await screen.findByLabelText(a.messageLabel)) as HTMLTextAreaElement;
    expect(message.value).toBe(
      "أهلاً Mona، لاحظنا إنك ما كملتش طلبك من Sara Shop. تقدر تكمله من هنا:\n" + URL,
    );
  });
});
