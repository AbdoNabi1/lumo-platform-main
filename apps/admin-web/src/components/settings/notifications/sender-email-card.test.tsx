import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type { NotificationSettingsSnapshot } from "@/lib/notification-settings-model";
import { SETTINGS } from "./test-fixtures";
import { SenderEmailCard } from "./sender-email-card";

const saveAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/settings/notifications/actions", () => ({
  saveNotificationSettingsAction: saveAction,
  startSenderDomainAction: vi.fn(),
  verifySenderDomainAction: vi.fn(),
}));

const copy = en.notificationSettings;

beforeEach(() => {
  cleanup();
  saveAction
    .mockReset()
    .mockImplementation(async (input: { patch: { senderEmail: string | null } }) => ({
      status: "success",
      settings: {
        ...SETTINGS,
        version: 4,
        values: { ...SETTINGS.values, senderEmail: input.patch.senderEmail },
      },
    }));
});

/** Holds the document the way the panel does: a save replaces it, so the card sees the new version. */
function Harness({
  initial,
  t,
  onSaved,
}: {
  readonly initial: NotificationSettingsSnapshot;
  readonly t: Dictionary;
  readonly onSaved: (settings: NotificationSettingsSnapshot) => void;
}) {
  const [document, setDocument] = useState(initial);
  return (
    <SenderEmailCard
      document={document}
      onSaved={(next) => {
        setDocument(next);
        onSaved(next);
      }}
      t={t}
    />
  );
}

function renderCard(
  document: NotificationSettingsSnapshot = SETTINGS,
  t: Dictionary = en,
  onSaved = vi.fn(),
) {
  render(<Harness initial={document} t={t} onSaved={onSaved} />);
  return onSaved;
}

function status(): HTMLElement {
  return screen.getByTestId("sender-status");
}

describe("SenderEmailCard (Wave 2b)", () => {
  it("shows the store name and Reply-To while the domain is not verified", () => {
    expect.hasAssertions();
    renderCard();

    expect(status()).toHaveTextContent(
      "Emails show Nusuj Store and replies go to orders@shop.example",
    );
    expect(screen.getByLabelText(copy.senderLabel)).toHaveValue("orders@shop.example");
  });

  it("says customers get emails from the address once its domain is verified", () => {
    expect.hasAssertions();
    renderCard({ ...SETTINGS, sender: { ...SETTINGS.sender, mode: "own_domain" } });

    expect(status()).toHaveTextContent("Customers get emails from orders@shop.example");
  });

  it("puts the email and the store name in <bdi dir=auto> so they cannot reorder the sentence", () => {
    expect.hasAssertions();
    renderCard();

    const isolated = Array.from(status().querySelectorAll("bdi[dir='auto']")).map(
      (node) => node.textContent,
    );
    expect(isolated).toEqual(["Nusuj Store", "orders@shop.example"]);
  });

  it("keeps the same isolation in Arabic", () => {
    expect.hasAssertions();
    renderCard(SETTINGS, ar);

    expect(status().querySelectorAll("bdi[dir='auto']")).toHaveLength(2);
    expect(status()).toHaveTextContent(
      "الإيميلات بتظهر باسم Nusuj Store والردود بتروح على orders@shop.example",
    );
  });

  it("explains that a free-mail address can never be the From, only when it is one", () => {
    expect.hasAssertions();
    renderCard({
      ...SETTINGS,
      sender: { mode: "reply_to", effectiveEmail: "me@gmail.com", freeMail: true },
    });
    expect(screen.getByText(copy.senderFreeMail)).toBeInTheDocument();

    cleanup();
    renderCard();
    expect(screen.queryByText(copy.senderFreeMail)).toBeNull();
  });

  it("asks for a sender email when there is none to show", () => {
    expect.hasAssertions();
    renderCard({
      ...SETTINGS,
      values: { ...SETTINGS.values, senderEmail: null },
      sender: { mode: "platform_only", effectiveEmail: null, freeMail: false },
    });

    expect(status()).toHaveTextContent(
      "Emails show Nusuj Store. Add a sender email so replies reach you.",
    );
    expect(screen.getByLabelText(copy.senderLabel)).toHaveAttribute(
      "placeholder",
      "hello@shop.example",
    );
  });

  it("keeps Save off until the address changes, then saves it with the loaded version", async () => {
    expect.hasAssertions();
    const onSaved = renderCard();
    const save = screen.getByRole("button", { name: copy.save });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(copy.senderLabel), {
      target: { value: "  Sales@Shop.Example " },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(saveAction).toHaveBeenCalledWith({
      expectedVersion: 3,
      patch: { senderEmail: "sales@shop.example" },
    });
    expect(await screen.findByText(copy.saved)).toBeInTheDocument();
  });

  it("saves a blank box as 'use the store email' (null)", async () => {
    expect.hasAssertions();
    renderCard();

    fireEvent.change(screen.getByLabelText(copy.senderLabel), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    await vi.waitFor(() => expect(saveAction).toHaveBeenCalled());
    expect(saveAction).toHaveBeenCalledWith({ expectedVersion: 3, patch: { senderEmail: null } });
  });

  it("refuses an address that is not an email without calling the server", () => {
    expect.hasAssertions();
    renderCard();

    fireEvent.change(screen.getByLabelText(copy.senderLabel), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(screen.getByText(copy.senderInvalid)).toBeInTheDocument();
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("shows the conflict message when someone else saved first, and keeps what was typed", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "error",
      message: copy.conflict,
      fieldErrors: {},
    });
    const onSaved = renderCard();

    fireEvent.change(screen.getByLabelText(copy.senderLabel), {
      target: { value: "a@shop.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.conflict);
    expect(screen.getByLabelText(copy.senderLabel)).toHaveValue("a@shop.example");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the server's field refusal next to the input", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { senderEmail: copy.senderInvalid },
    });
    renderCard();

    fireEvent.change(screen.getByLabelText(copy.senderLabel), {
      target: { value: "a@shop.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByText(copy.senderInvalid)).toBeInTheDocument();
  });

  it("uses no physical-side classes", () => {
    expect.hasAssertions();
    const { container } = render(<SenderEmailCard document={SETTINGS} onSaved={vi.fn()} t={ar} />);
    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
  });
});
