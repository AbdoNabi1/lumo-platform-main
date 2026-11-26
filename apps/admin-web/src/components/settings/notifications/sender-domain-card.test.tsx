import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type { SenderDomainDto } from "@/lib/notification-settings-model";
import { DOMAIN_NONE, DOMAIN_PENDING, DOMAIN_VERIFIED } from "./test-fixtures";
import { SenderDomainCard } from "./sender-domain-card";

const actions = vi.hoisted(() => ({
  startSenderDomainAction: vi.fn(),
  verifySenderDomainAction: vi.fn(),
}));
vi.mock("@/app/settings/notifications/actions", () => ({
  ...actions,
  saveNotificationSettingsAction: vi.fn(),
}));

const copy = en.notificationSettings;

beforeEach(() => {
  cleanup();
  actions.startSenderDomainAction.mockReset();
  actions.verifySenderDomainAction.mockReset();
});

function renderCard(senderDomain: SenderDomainDto | null, t: Dictionary = en) {
  return render(<SenderDomainCard senderDomain={senderDomain} t={t} />);
}

describe("SenderDomainCard (Wave 2b, D43)", () => {
  it("offers 'Authenticate domain' with the domain it would authenticate", () => {
    expect.hasAssertions();
    renderCard(DOMAIN_NONE);

    expect(screen.getByRole("button", { name: copy.domainAuthenticate })).toBeEnabled();
    expect(screen.getByText("shop.example")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the DNS records as a table of type, name and value after authenticating", async () => {
    expect.hasAssertions();
    actions.startSenderDomainAction.mockResolvedValue({
      status: "success",
      domain: DOMAIN_PENDING,
    });
    renderCard(DOMAIN_NONE);

    fireEvent.click(screen.getByRole("button", { name: copy.domainAuthenticate }));

    const table = await screen.findByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([copy.colType, copy.colName, copy.colValue, copy.colPriority]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("TXT")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("resend._domainkey")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("p=MIGfMA0GCSq")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("10")).toBeInTheDocument();
    expect(screen.getByText(copy.statusPending)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.domainVerify })).toBeInTheDocument();
    expect(actions.startSenderDomainAction).toHaveBeenCalledTimes(1);
  });

  it("copies a record's name and value to the clipboard", async () => {
    expect.hasAssertions();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderCard(DOMAIN_PENDING);

    fireEvent.click(
      screen.getByRole("button", {
        name: copy.copyValue.replace("{type}", "TXT").replace("{name}", "resend._domainkey"),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: copy.copyName.replace("{type}", "MX").replace("{name}", "send"),
      }),
    );

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenNthCalledWith(1, "p=MIGfMA0GCSq");
    expect(writeText).toHaveBeenNthCalledWith(2, "send");
    expect(await screen.findAllByText(copy.copied)).toHaveLength(2);
  });

  it("verifies, and a verified domain shows the chip and the note with no table or Verify", async () => {
    expect.hasAssertions();
    actions.verifySenderDomainAction.mockResolvedValue({
      status: "success",
      domain: DOMAIN_VERIFIED,
    });
    renderCard(DOMAIN_PENDING);

    fireEvent.click(screen.getByRole("button", { name: copy.domainVerify }));

    expect(await screen.findByText(copy.statusVerified)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "shop.example is verified. Emails now come from your own address.",
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: copy.domainVerify })).toBeNull();
  });

  it("says it is not verified yet when the check comes back pending", async () => {
    expect.hasAssertions();
    actions.verifySenderDomainAction.mockResolvedValue({
      status: "success",
      domain: DOMAIN_PENDING,
    });
    renderCard(DOMAIN_PENDING);

    fireEvent.click(screen.getByRole("button", { name: copy.domainVerify }));

    await vi.waitFor(() => expect(actions.verifySenderDomainAction).toHaveBeenCalled());
    expect(screen.getByText(copy.domainNotVerifiedNote)).toBeInTheDocument();
    expect(screen.getByText(copy.statusPending)).toBeInTheDocument();
  });

  it("shows a failed status as a failed chip", () => {
    expect.hasAssertions();
    renderCard({
      ...DOMAIN_PENDING,
      domain: { ...DOMAIN_PENDING.domain!, status: "failed" },
    });

    expect(screen.getByText(copy.statusFailed)).toBeInTheDocument();
  });

  it("shows 'used by another store' when the server refuses the domain", async () => {
    expect.hasAssertions();
    actions.startSenderDomainAction.mockResolvedValue({
      status: "error",
      message: copy.domainUsedByAnotherStore,
    });
    renderCard(DOMAIN_NONE);

    fireEvent.click(screen.getByRole("button", { name: copy.domainAuthenticate }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.domainUsedByAnotherStore);
    expect(screen.getByRole("button", { name: copy.domainAuthenticate })).toBeEnabled();
  });

  it("says 'not available yet' when the server has no provider, with no button to press", () => {
    expect.hasAssertions();
    renderCard({ available: false, domain: null, suggestion: DOMAIN_NONE.suggestion });

    expect(screen.getByText(copy.domainNotAvailable)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.domainAuthenticate })).toBeNull();
  });

  it("switches to 'not available yet' when the server answers 503", async () => {
    expect.hasAssertions();
    actions.startSenderDomainAction.mockResolvedValue({ status: "unavailable" });
    renderCard(DOMAIN_NONE);

    fireEvent.click(screen.getByRole("button", { name: copy.domainAuthenticate }));

    expect(await screen.findByText(copy.domainNotAvailable)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.domainAuthenticate })).toBeNull();
  });

  it("offers no authentication for a free-mail domain and says why", () => {
    expect.hasAssertions();
    renderCard({
      available: true,
      domain: null,
      suggestion: { domain: "gmail.com", freeMail: true },
    });

    expect(screen.getByText(/can't be authenticated/)).toHaveTextContent(
      "gmail.com can't be authenticated. Replies will still reach you.",
    );
    expect(screen.queryByRole("button", { name: copy.domainAuthenticate })).toBeNull();
  });

  it("asks for a sender email first when there is none", () => {
    expect.hasAssertions();
    renderCard({ available: true, domain: null, suggestion: null });

    expect(screen.getByText(copy.domainNeedsEmail)).toBeInTheDocument();
  });

  it("says it could not load when the domain read failed, without breaking the page", () => {
    expect.hasAssertions();
    renderCard(null);

    expect(screen.getByText(copy.loadError)).toBeInTheDocument();
  });

  it("renders in Arabic with logical classes only", () => {
    expect.hasAssertions();
    const { container } = renderCard(DOMAIN_PENDING, ar);

    expect(
      screen.getByRole("button", { name: ar.notificationSettings.domainVerify }),
    ).toBeInTheDocument();
    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
  });
});
