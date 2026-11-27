import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type { AdPlatformFormState, ConnectionViewDto } from "@/lib/ad-platforms-model";
import { AdPlatformsForm } from "./ad-platforms-form";

const saveAction =
  vi.fn<(previous: AdPlatformFormState, formData: FormData) => Promise<AdPlatformFormState>>();
vi.mock("@/app/settings/ad-platforms/actions", () => ({
  saveAdPlatformAction: (previous: AdPlatformFormState, formData: FormData) =>
    saveAction(previous, formData),
}));

const copy = en.adPlatformsSettings;
const TOKEN = "fake-secret-value-9876";

function emptyView(platform: ConnectionViewDto["platform"]): ConnectionViewDto {
  return {
    platform,
    enabled: false,
    publicConfig: null,
    secret: { configured: false, last4: null },
    testEventCode: null,
    complete: false,
    live: false,
    version: 0,
  };
}

const META_LIVE: ConnectionViewDto = {
  ...emptyView("meta"),
  enabled: true,
  publicConfig: { platform: "meta", pixelId: "12345678901234" },
  secret: { configured: true, last4: "1234" },
  testEventCode: "TEST123",
  complete: true,
  live: true,
  version: 3,
};

const TIKTOK_INCOMPLETE: ConnectionViewDto = {
  ...emptyView("tiktok"),
  enabled: true,
  publicConfig: { platform: "tiktok", pixelCode: "ABCDEFGHIJKL" },
  version: 1,
};

const GA4_OFF_COMPLETE: ConnectionViewDto = {
  ...emptyView("ga4"),
  publicConfig: { platform: "ga4", measurementId: "G-ABCD1234" },
  secret: { configured: true, last4: "5678" },
  complete: true,
  version: 2,
};

const VIEWS: readonly ConnectionViewDto[] = [
  META_LIVE,
  TIKTOK_INCOMPLETE,
  emptyView("snap"),
  GA4_OFF_COMPLETE,
  emptyView("google_ads"),
];

beforeEach(() => {
  cleanup();
  saveAction.mockReset().mockResolvedValue({ status: "success", view: META_LIVE });
});

function renderForm(
  overrides: { views?: readonly ConnectionViewDto[]; siteType?: "store" | "lead_site" } = {},
  dictionary: Dictionary = en,
) {
  return render(
    <AdPlatformsForm
      views={overrides.views ?? VIEWS}
      siteType={overrides.siteType}
      t={dictionary}
    />,
  );
}

function card(name: string): HTMLElement {
  return screen.getByRole("form", { name });
}

function input(within_: HTMLElement, label: string): HTMLInputElement {
  return within(within_).getByLabelText(label) as HTMLInputElement;
}

function saveButton(within_: HTMLElement): HTMLElement {
  return within(within_).getByRole("button", { name: copy.save });
}

function change(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } });
}

async function submitted(within_: HTMLElement, call = 0): Promise<FormData> {
  fireEvent.click(saveButton(within_));
  await waitFor(() => expect(saveAction.mock.calls.length).toBeGreaterThan(call));
  const entry = saveAction.mock.calls[call];
  if (entry === undefined) throw new Error("the action was not called");
  return entry[1];
}

const body = () => within(document.body);

describe("AdPlatformsForm: the cards", () => {
  it("renders one card per platform in the platform order, vendor names isolated", () => {
    expect.hasAssertions();
    renderForm();

    const forms = screen.getAllByRole("form");
    expect(forms.map((form) => form.getAttribute("aria-labelledby") !== null)).toEqual(
      Array(5).fill(true),
    );
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(["Meta", "TikTok", "Snapchat", "Google Analytics 4", "Google Ads"]);
    for (const heading of screen.getAllByRole("heading", { level: 3 })) {
      expect(heading.querySelector("bdi")).toHaveAttribute("dir", "auto");
    }
  });

  it("shows Live, Incomplete and Off from live / complete / enabled", () => {
    expect.hasAssertions();
    renderForm();

    expect(within(card("Meta")).getByText(copy.statusLive)).toBeInTheDocument();
    expect(within(card("TikTok")).getByText(copy.statusIncomplete)).toBeInTheDocument();
    expect(within(card("Snapchat")).getByText(copy.statusOff)).toBeInTheDocument();
    // Complete but switched off is Off, not Live.
    expect(within(card("Google Analytics 4")).getByText(copy.statusOff)).toBeInTheDocument();
    expect(screen.getByTestId("ad-status-meta")).toHaveClass("bg-success-subtle");
    expect(screen.getByTestId("ad-status-tiktok")).toHaveClass("bg-warning-subtle");
    expect(screen.getByTestId("ad-status-snap")).toHaveClass("bg-secondary");
  });

  it("offers a test event code on Meta and TikTok only", () => {
    expect.hasAssertions();
    renderForm();

    for (const name of ["Meta", "TikTok"]) {
      expect(within(card(name)).getByLabelText(copy.testEventCode)).toBeInTheDocument();
    }
    for (const name of ["Snapchat", "Google Analytics 4", "Google Ads"]) {
      expect(within(card(name)).queryByLabelText(copy.testEventCode)).toBeNull();
    }
    expect(input(card("Meta"), copy.testEventCode).value).toBe("TEST123");
  });

  it("gives the four server platforms a token box and Google Ads conversion id + three labels, no token", () => {
    expect.hasAssertions();
    renderForm();

    for (const name of ["Meta", "TikTok", "Snapchat", "Google Analytics 4"]) {
      expect(input(card(name), copy.token)).toHaveAttribute("type", "password");
    }
    const google = card("Google Ads");
    expect(within(google).queryByLabelText(copy.token)).toBeNull();
    for (const label of [
      copy.conversionId,
      copy.labelLead,
      copy.labelContact,
      copy.labelPurchase,
    ]) {
      expect(input(google, label)).toHaveAttribute("dir", "ltr");
    }
    expect(within(google).getByRole("note")).toHaveTextContent(copy.googleNote);
  });

  it("labels every id box and keeps them left-to-right, off autocomplete", () => {
    expect.hasAssertions();
    renderForm();

    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      ["Meta", copy.pixelId, "12345678901234"],
      ["TikTok", copy.pixelCode, "ABCDEFGHIJKL"],
      ["Snapchat", copy.pixelId, ""],
      ["Google Analytics 4", copy.measurementId, "G-ABCD1234"],
    ];
    for (const [name, label, value] of pairs) {
      const box = input(card(name), label);
      expect(box).toHaveAttribute("dir", "ltr");
      expect(box).toHaveAttribute("autocomplete", "off");
      expect(box.value).toBe(value);
    }
    expect(input(card("Meta"), copy.pixelId)).toHaveAttribute("inputmode", "numeric");
  });

  it("shows the site-type note: lead sites send lead events, stores commerce events", () => {
    expect.hasAssertions();
    const { rerender } = renderForm({ siteType: "lead_site" });
    expect(screen.getAllByRole("note")[0]).toHaveTextContent(copy.siteTypeLead);

    rerender(<AdPlatformsForm views={VIEWS} siteType="store" t={en} />);
    expect(screen.getAllByRole("note")[0]).toHaveTextContent(copy.siteTypeStore);

    rerender(<AdPlatformsForm views={VIEWS} siteType={undefined} t={en} />);
    expect(screen.queryByText(copy.siteTypeLead)).toBeNull();
    expect(screen.queryByText(copy.siteTypeStore)).toBeNull();
  });
});

describe("AdPlatformsForm: the token is write-only", () => {
  it("never puts the saved token in the page: only 'Token ending in 1234' and a masked placeholder", () => {
    expect.hasAssertions();
    renderForm();

    const meta = card("Meta");
    const token = input(meta, copy.token);
    expect(token.value).toBe("");
    expect(token).toHaveAttribute("placeholder", "\u2022\u2022\u2022\u20221234");
    expect(within(meta).getByTestId("ad-token-meta")).toHaveTextContent("Token ending in 1234");
    expect(within(meta).getByTestId("ad-token-meta").querySelector("bdi")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(meta).toHaveTextContent(copy.tokenKeep);
    // A platform with no token says so and offers no removal.
    expect(within(card("TikTok")).getByText(copy.tokenNone)).toBeInTheDocument();
    expect(within(card("TikTok")).queryByRole("button", { name: /Remove token/ })).toBeNull();
  });

  it("posts a blank token box as empty text (the action keeps the saved token)", async () => {
    expect.hasAssertions();
    renderForm();
    const meta = card("Meta");
    change(input(meta, copy.pixelId), "99999999999999");

    const data = await submitted(meta);

    expect(data.get("secret")).toBe("");
    expect(data.get("clearSecret")).toBeNull();
  });

  it("empties the token box after a successful save and leaves the token nowhere in the page", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "success",
      view: { ...META_LIVE, version: 4, secret: { configured: true, last4: "9876" } },
    });
    renderForm();
    const meta = card("Meta");
    const token = input(meta, copy.token);
    change(token, TOKEN);
    expect(token.value).toBe(TOKEN);

    const data = await submitted(meta);

    expect(data.get("secret")).toBe(TOKEN);
    await waitFor(() => expect(within(meta).getByRole("status")).toHaveTextContent(copy.saved));
    expect(input(meta, copy.token).value).toBe("");
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
    for (const box of Array.from(document.body.querySelectorAll("input"))) {
      expect(box.value).not.toContain(TOKEN);
    }
    expect(within(meta).getByTestId("ad-token-meta")).toHaveTextContent("Token ending in 9876");
  });
});

describe("AdPlatformsForm: saving", () => {
  it("keeps Save off until something changes, then posts the card's fields and version", async () => {
    expect.hasAssertions();
    renderForm();
    const meta = card("Meta");
    expect(saveButton(meta)).toBeDisabled();

    change(input(meta, copy.pixelId), "99999999999999");
    expect(saveButton(meta)).toBeEnabled();
    expect(within(meta).getByText(copy.unsaved)).toBeInTheDocument();
    const data = await submitted(meta);

    expect(data.get("platform")).toBe("meta");
    expect(data.get("expectedVersion")).toBe("3");
    expect(data.get("enabled")).toBe("on");
    expect(data.get("pixelId")).toBe("99999999999999");
    expect(data.get("testEventCode")).toBe("TEST123");
  });

  it("an unticked switch posts nothing for enabled", async () => {
    expect.hasAssertions();
    renderForm();
    const meta = card("Meta");
    fireEvent.click(within(meta).getByRole("switch", { name: copy.enabled }));

    const data = await submitted(meta);

    expect(data.get("enabled")).toBeNull();
  });

  it("saves one platform at a time: another card's fields are not in the post", async () => {
    expect.hasAssertions();
    renderForm();
    const snap = card("Snapchat");
    change(input(snap, copy.pixelId), "12345678-1234-1234-1234-123456789012");

    const data = await submitted(snap);

    expect(data.get("platform")).toBe("snap");
    expect(data.get("expectedVersion")).toBe("0");
    expect(data.get("pixelCode")).toBeNull();
    expect(data.get("measurementId")).toBeNull();
  });

  it("a second save sends the incremented version, with no reload in between", async () => {
    expect.hasAssertions();
    saveAction
      .mockResolvedValueOnce({
        status: "success",
        view: { ...META_LIVE, version: 4, publicConfig: { platform: "meta", pixelId: "11111111" } },
      })
      .mockResolvedValueOnce({ status: "success", view: { ...META_LIVE, version: 5 } });
    renderForm();
    const meta = card("Meta");

    change(input(meta, copy.pixelId), "11111111");
    const first = await submitted(meta, 0);
    await waitFor(() => expect(within(meta).getByRole("status")).toHaveTextContent(copy.saved));
    expect(input(meta, copy.pixelId).value).toBe("11111111");
    change(input(meta, copy.pixelId), "22222222");
    const second = await submitted(meta, 1);

    expect(first.get("expectedVersion")).toBe("3");
    expect(second.get("expectedVersion")).toBe("4");
  });

  it("a saved card moves its badge from Incomplete to Live", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "success",
      view: {
        ...TIKTOK_INCOMPLETE,
        version: 2,
        secret: { configured: true, last4: "4321" },
        complete: true,
        live: true,
      },
    });
    renderForm();
    const tiktok = card("TikTok");
    change(input(tiktok, copy.token), TOKEN);

    await submitted(tiktok);

    await waitFor(() => expect(within(tiktok).getByText(copy.statusLive)).toBeInTheDocument());
    expect(within(tiktok).getByTestId("ad-token-tiktok")).toHaveTextContent("Token ending in 4321");
  });

  it("shows the API's field errors next to their boxes and a message as an alert", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { pixelId: copy.fieldInvalid, secret: copy.tokenInvalid },
    });
    renderForm();
    const meta = card("Meta");
    change(input(meta, copy.pixelId), "abc");
    change(input(meta, copy.token), "short");

    await submitted(meta);

    expect(await within(meta).findByRole("alert")).toHaveTextContent(en.formErrors.invalid);
    expect(input(meta, copy.pixelId)).toHaveAttribute("aria-invalid", "true");
    expect(input(meta, copy.token)).toHaveAttribute("aria-invalid", "true");
    expect(meta).toHaveTextContent(copy.fieldInvalid);
    expect(meta).toHaveTextContent(copy.tokenInvalid);
    // A refusal keeps what was typed so it can be fixed and sent again.
    expect(input(meta, copy.pixelId).value).toBe("abc");
  });

  it("shows a conflict as 'someone else changed this'", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({ status: "error", message: copy.conflict, conflict: true });
    renderForm();
    const meta = card("Meta");
    change(input(meta, copy.pixelId), "99999999999999");

    await submitted(meta);

    expect(await within(meta).findByRole("alert")).toHaveTextContent(copy.conflict);
  });

  it("shows 'Not available yet' when the server cannot store tokens", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({ status: "error", message: copy.unavailable });
    renderForm();
    const meta = card("Meta");
    change(input(meta, copy.token), TOKEN);

    await submitted(meta);

    expect(await within(meta).findByRole("alert")).toHaveTextContent("Not available yet");
  });

  it("adopts a newer version from the server (a reload) and drops what was typed", () => {
    expect.hasAssertions();
    const { rerender } = renderForm();
    const meta = card("Meta");
    change(input(meta, copy.pixelId), "99999999999999");

    rerender(
      <AdPlatformsForm
        views={[
          {
            ...META_LIVE,
            version: 7,
            publicConfig: { platform: "meta", pixelId: "55555555555" },
          },
          ...VIEWS.slice(1),
        ]}
        siteType={undefined}
        t={en}
      />,
    );

    expect(input(card("Meta"), copy.pixelId).value).toBe("55555555555");
    expect(
      (card("Meta").querySelector('input[name="expectedVersion"]') as HTMLInputElement).value,
    ).toBe("7");
  });
});

describe("AdPlatformsForm: Remove token", () => {
  async function openDialog() {
    renderForm();
    const meta = card("Meta");
    const trigger = within(meta).getByRole("button", { name: /Remove token/ });
    fireEvent.click(trigger);
    const dialog = await body().findByRole("dialog", { name: copy.removeTitle });
    return { meta, trigger, dialog };
  }

  it("opens a real dialog with a title and a description, focus on Cancel", async () => {
    expect.hasAssertions();
    const { dialog } = await openDialog();

    expect(dialog).toHaveAccessibleDescription(copy.removeBody);
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: copy.removeCancel })).toHaveFocus(),
    );
    expect(within(dialog).getByRole("button", { name: copy.removeConfirm })).not.toHaveFocus();
  });

  it("Escape closes it, focus returns to the trigger and nothing is sent", async () => {
    expect.hasAssertions();
    const { trigger, dialog } = await openDialog();

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toBeInTheDocument();
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("Cancel closes it, focus returns to the trigger and nothing is sent", async () => {
    expect.hasAssertions();
    const { trigger, dialog } = await openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: copy.removeCancel }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("confirming sends clearSecret with no secret, from the saved view and not the typed draft", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({
      status: "success",
      view: {
        ...META_LIVE,
        version: 4,
        secret: { configured: false, last4: null },
        complete: false,
        live: false,
      },
    });
    const { meta, dialog } = await openDialog();
    // An unsaved edit beside it is not part of the removal.
    change(input(meta, copy.pixelId), "99999999999999");

    fireEvent.click(within(dialog).getByRole("button", { name: copy.removeConfirm }));

    await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));
    const data = saveAction.mock.calls[0]?.[1] as FormData;
    expect(data.get("clearSecret")).toBe("on");
    expect(data.get("secret")).toBeNull();
    expect(data.get("platform")).toBe("meta");
    expect(data.get("expectedVersion")).toBe("3");
    expect(data.get("pixelId")).toBe("12345678901234");
    expect(data.get("enabled")).toBe("on");
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    // Saved: no token any more, the card is Incomplete, the button is gone and the box has focus.
    await waitFor(() => expect(within(meta).getByText(copy.statusIncomplete)).toBeInTheDocument());
    expect(within(meta).queryByRole("button", { name: /Remove token/ })).toBeNull();
    expect(within(meta).getByText(copy.tokenNone)).toBeInTheDocument();
    expect(input(meta, copy.token)).toHaveFocus();
    // The edit that was not part of the removal is still there, unsaved.
    expect(input(meta, copy.pixelId).value).toBe("99999999999999");
  });

  it("a refused removal leaves the token and the button as they were", async () => {
    expect.hasAssertions();
    saveAction.mockResolvedValue({ status: "error", message: copy.conflict, conflict: true });
    const { meta, dialog } = await openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: copy.removeConfirm }));

    expect(await within(meta).findByRole("alert")).toHaveTextContent(copy.conflict);
    expect(within(meta).getByRole("button", { name: /Remove token/ })).toBeInTheDocument();
    expect(within(meta).getByTestId("ad-token-meta")).toHaveTextContent("Token ending in 1234");
  });
});

describe("AdPlatformsForm: Arabic and logical CSS", () => {
  it("takes every label from the Arabic dictionary, vendor names unchanged", () => {
    expect.hasAssertions();
    renderForm({ siteType: "lead_site" }, ar);

    const arCopy = ar.adPlatformsSettings;
    const meta = screen.getAllByRole("form")[0] as HTMLElement;
    expect(within(meta).getByLabelText(arCopy.pixelId)).toBeInTheDocument();
    expect(within(meta).getByLabelText(arCopy.token)).toBeInTheDocument();
    expect(within(meta).getByLabelText(arCopy.testEventCode)).toBeInTheDocument();
    expect(within(meta).getByText(arCopy.statusLive)).toBeInTheDocument();
    expect(within(meta).getByRole("button", { name: arCopy.save })).toBeInTheDocument();
    expect(within(meta).getByTestId("ad-token-meta")).toHaveTextContent("1234");
    expect(screen.getByText(arCopy.siteTypeLead)).toBeInTheDocument();
    expect(within(meta).getByRole("heading", { level: 3 })).toHaveTextContent("Meta");
  });

  it("uses no physical-side classes", () => {
    expect.hasAssertions();
    const { container } = renderForm({ siteType: "store" });

    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
  });
});
