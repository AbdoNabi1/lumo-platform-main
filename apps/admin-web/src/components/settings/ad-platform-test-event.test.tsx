import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import type {
  AdPlatformFormState,
  AdPlatformKey,
  AdPlatformTestState,
  ConnectionViewDto,
} from "@/lib/ad-platforms-model";
import { AdPlatformsForm } from "./ad-platforms-form";

/**
 * Settings > Ad platforms: "Send test event" (Tracking P2-D11). The server action is a double; what is under test is
 * what the page does with each answer: one button per testing platform, a pending state, a polite result region,
 * the saved-test-code warning, brand names in <bdi dir="auto">, and that nothing secret is ever in the page.
 */

const saveAction =
  vi.fn<(previous: AdPlatformFormState, formData: FormData) => Promise<AdPlatformFormState>>();
const testAction =
  vi.fn<(previous: AdPlatformTestState, formData: FormData) => Promise<AdPlatformTestState>>();
vi.mock("@/app/settings/ad-platforms/actions", () => ({
  saveAdPlatformAction: (previous: AdPlatformFormState, formData: FormData) =>
    saveAction(previous, formData),
  sendAdPlatformTestEventAction: (previous: AdPlatformTestState, formData: FormData) =>
    testAction(previous, formData),
}));

const copy = en.adPlatformsSettings;
const SENT_AT = "2026-11-28T10:00:00.000Z";

function view(
  platform: AdPlatformKey,
  overrides: Partial<ConnectionViewDto> = {},
): ConnectionViewDto {
  return {
    platform,
    enabled: false,
    publicConfig: null,
    secret: { configured: false, last4: null },
    testEventCode: null,
    complete: false,
    live: false,
    version: 0,
    ...overrides,
  };
}

const META_WITH_CODE = view("meta", {
  enabled: true,
  publicConfig: { platform: "meta", pixelId: "12345678901234" },
  secret: { configured: true, last4: "1234" },
  testEventCode: "SAVED123",
  complete: true,
  live: true,
  version: 3,
});
const TIKTOK_NO_CODE = view("tiktok", {
  enabled: true,
  publicConfig: { platform: "tiktok", pixelCode: "ABCDEFGHIJKL" },
  secret: { configured: true, last4: "5678" },
  complete: true,
  live: true,
  version: 1,
});
const VIEWS: readonly ConnectionViewDto[] = [
  META_WITH_CODE,
  TIKTOK_NO_CODE,
  view("snap"),
  view("ga4"),
  view("google_ads"),
];

beforeEach(() => {
  cleanup();
  saveAction.mockReset().mockResolvedValue({ status: "success", view: META_WITH_CODE });
  testAction.mockReset();
});

function renderForm(dictionary: Dictionary = en, views: readonly ConnectionViewDto[] = VIEWS) {
  return render(<AdPlatformsForm views={views} siteType="store" t={dictionary} />);
}

function card(name: string): HTMLElement {
  return screen.getByRole("form", { name });
}

function testButton(name: string, dictionary: Dictionary = en): HTMLElement {
  return within(card(name)).getByRole("button", {
    name: dictionary.adPlatformsSettings.testEventButton,
  });
}

function result(platform: AdPlatformKey): HTMLElement {
  return screen.getByTestId(`ad-test-result-${platform}`);
}

function sent(
  platform: AdPlatformKey,
  extra: Partial<Extract<AdPlatformTestState, { status: "done" }>["result"]> = {},
): AdPlatformTestState {
  return {
    status: "done",
    platform,
    result: { platform, status: "sent", vendorStatus: 200, sentAt: SENT_AT, ...extra },
  };
}

function lastForm(): FormData {
  const call = testAction.mock.calls.at(-1);
  if (call === undefined) throw new Error("the test action was not called");
  return call[1];
}

describe("the Send test event button", () => {
  it("is on Meta, TikTok, Snapchat and GA4, and not on Google Ads (no server events)", () => {
    expect.hasAssertions();
    renderForm();

    for (const name of ["Meta", "TikTok", "Snapchat", "Google Analytics 4"]) {
      expect(testButton(name)).toBeInTheDocument();
    }
    expect(
      within(card("Google Ads")).queryByRole("button", { name: copy.testEventButton }),
    ).toBeNull();
  });

  it("is a plain button inside a card whose form is the save form: pressing it saves nothing", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue(sent("meta"));
    renderForm();

    expect(testButton("Meta")).toHaveAttribute("type", "button");
    fireEvent.click(testButton("Meta"));

    await waitFor(() => expect(testAction).toHaveBeenCalledTimes(1));
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("sends the platform and the code typed in the box, trimmed, nothing else", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue(sent("meta"));
    renderForm();
    fireEvent.change(within(card("Meta")).getByLabelText(copy.testEventCode), {
      target: { value: "  TYPED99 " },
    });

    fireEvent.click(testButton("Meta"));

    await waitFor(() => expect(testAction).toHaveBeenCalledTimes(1));
    const data = lastForm();
    expect([...data.keys()].sort()).toEqual(["platform", "testEventCode"]);
    expect(data.get("platform")).toBe("meta");
    expect(data.get("testEventCode")).toBe("TYPED99");
  });

  it("sends the saved code's box as it is, and no code field at all when the box is empty", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue(sent("tiktok"));
    renderForm();

    fireEvent.click(testButton("TikTok"));
    await waitFor(() => expect(testAction).toHaveBeenCalledTimes(1));
    expect(lastForm().get("testEventCode")).toBeNull();

    fireEvent.click(testButton("Meta"));
    await waitFor(() => expect(testAction).toHaveBeenCalledTimes(2));
    expect(lastForm().get("testEventCode")).toBe("SAVED123");
  });

  it("never sends a code field for GA4 or Snapchat (they have no code)", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue(sent("ga4"));
    renderForm();

    fireEvent.click(testButton("Google Analytics 4"));

    await waitFor(() => expect(testAction).toHaveBeenCalledTimes(1));
    expect([...lastForm().keys()]).toEqual(["platform"]);
  });

  it("shows a pending state: busy, disabled, 'Sending…', and does not send twice", async () => {
    expect.hasAssertions();
    let finish: (state: AdPlatformTestState) => void = () => undefined;
    testAction.mockImplementation(
      () =>
        new Promise<AdPlatformTestState>((resolve) => {
          finish = resolve;
        }),
    );
    renderForm();

    fireEvent.click(testButton("Meta"));

    const pending = await within(card("Meta")).findByRole("button", {
      name: copy.testEventSending,
    });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    fireEvent.click(pending);
    expect(testAction).toHaveBeenCalledTimes(1);
    // The other cards are not held up by this one.
    expect(testButton("TikTok")).toBeEnabled();

    await act(async () => {
      finish(sent("meta"));
      await Promise.resolve();
    });
    await waitFor(() => expect(testButton("Meta")).toBeEnabled());
  });

  it("gives keyboard focus back to the button when the answer arrives", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue(sent("meta"));
    renderForm();
    const button = testButton("Meta");
    button.focus();

    fireEvent.click(button);

    await waitFor(() => expect(result("meta")).toHaveTextContent(/Test event sent/));
    await waitFor(() => expect(testButton("Meta")).toHaveFocus());
  });

  it("does not take focus from where the person went meanwhile", async () => {
    expect.hasAssertions();
    let finish: (state: AdPlatformTestState) => void = () => undefined;
    testAction.mockImplementation(
      () =>
        new Promise<AdPlatformTestState>((resolve) => {
          finish = resolve;
        }),
    );
    renderForm();
    testButton("Meta").focus();
    fireEvent.click(testButton("Meta"));
    await within(card("Meta")).findByRole("button", { name: copy.testEventSending });
    const pixel = within(card("Meta")).getByLabelText(copy.pixelId);
    pixel.focus();

    await act(async () => {
      finish(sent("meta"));
      await Promise.resolve();
    });

    await waitFor(() => expect(testButton("Meta")).toBeEnabled());
    expect(pixel).toHaveFocus();
  });
});

describe("the result region", () => {
  it("is in the page from the start, polite, one per testing platform, empty until a test runs", () => {
    expect.hasAssertions();
    renderForm();

    for (const platform of ["meta", "tiktok", "snap", "ga4"] as const) {
      expect(result(platform)).toHaveAttribute("aria-live", "polite");
      expect(result(platform)).toBeEmptyDOMElement();
    }
    expect(screen.queryByTestId("ad-test-result-google_ads")).toBeNull();
  });

  it("says where to look when Meta or TikTok accepted it, brand name isolated", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue(sent("meta"));
    renderForm();

    fireEvent.click(testButton("Meta"));

    await waitFor(() => expect(result("meta")).toHaveTextContent(/Test event sent/));
    expect(result("meta")).toHaveTextContent("In Meta Events Manager, open Test events");
    const brand = result("meta").querySelector("bdi");
    expect(brand).toHaveAttribute("dir", "auto");
    expect(brand).toHaveTextContent("Meta");
  });

  it("GA4: accepted means 'checked, not counted'; problems are listed as left-to-right text", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValueOnce(sent("ga4", { messages: [] }));
    renderForm();

    fireEvent.click(testButton("Google Analytics 4"));
    await waitFor(() => expect(result("ga4")).toHaveTextContent(/isn't counted in your reports/));

    testAction.mockResolvedValueOnce({
      status: "done",
      platform: "ga4",
      result: {
        platform: "ga4",
        status: "rejected",
        vendorStatus: 200,
        messages: ["events[0].params.currency: Value must be a valid currency code."],
        sentAt: SENT_AT,
      },
    });
    fireEvent.click(testButton("Google Analytics 4"));
    await waitFor(() => expect(result("ga4")).toHaveTextContent(/found problems/));
    const items = within(result("ga4")).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(items[0]).toHaveTextContent(
      "events[0].params.currency: Value must be a valid currency code.",
    );
    expect(result("ga4").querySelector("bdi[dir='auto']")).toHaveTextContent("Google Analytics 4");
  });

  it.each([
    [401, /didn't accept your token/],
    [403, /didn't accept your token/],
    [400, /refused the test event \(status 400\)/],
  ])("a vendor %i is said plainly", async (vendorStatus, pattern) => {
    expect.hasAssertions();
    testAction.mockResolvedValue({
      status: "done",
      platform: "tiktok",
      result: { platform: "tiktok", status: "rejected", vendorStatus, sentAt: SENT_AT },
    });
    renderForm();

    fireEvent.click(testButton("TikTok"));

    await waitFor(() => expect(result("tiktok")).toHaveTextContent(pattern));
    expect(result("tiktok").querySelector("bdi[dir='auto']")).toHaveTextContent("TikTok");
  });

  it("no vendor status means we could not reach it", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue({
      status: "done",
      platform: "meta",
      result: { platform: "meta", status: "rejected", sentAt: SENT_AT },
    });
    renderForm();

    fireEvent.click(testButton("Meta"));

    await waitFor(() => expect(result("meta")).toHaveTextContent(/Couldn't reach/));
  });

  it.each([
    ["not_connected", copy.testNotConnected],
    ["invalid_code", copy.testInvalidCode],
    ["rate_limited", copy.testRateLimited],
    ["unavailable", copy.testUnavailable],
    ["unexpected", en.formErrors.unexpected],
    ["forbidden", en.formErrors.forbidden],
  ] as const)("a refused test (%s) is plain text in the result region", async (reason, text) => {
    expect.hasAssertions();
    testAction.mockResolvedValue({ status: "failed", platform: "meta", reason });
    renderForm();

    fireEvent.click(testButton("Meta"));

    await waitFor(() => expect(result("meta")).toHaveTextContent(text));
    expect(within(card("Meta")).queryByRole("alert")).toBeNull();
  });

  it("Meta without a code is told where to find it in Events Manager; Snapchat is told it has no test mode", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValueOnce({
      status: "failed",
      platform: "meta",
      reason: "code_required",
    });
    testAction.mockResolvedValueOnce({
      status: "failed",
      platform: "snap",
      reason: "not_supported",
    });
    renderForm();

    fireEvent.click(testButton("Meta"));
    await waitFor(() =>
      expect(result("meta")).toHaveTextContent(/Events Manager, open Test events/),
    );
    fireEvent.click(testButton("Snapchat"));
    await waitFor(() => expect(result("snap")).toHaveTextContent(/has no test mode/));
    const brands = [...result("snap").querySelectorAll("bdi[dir='auto']")];
    expect(brands.map((brand) => brand.textContent)).toEqual(["Snapchat", "Snapchat"]);
  });

  it("shows a result in its own card only", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue(sent("meta"));
    renderForm();

    fireEvent.click(testButton("Meta"));

    await waitFor(() => expect(result("meta")).toHaveTextContent(/Test event sent/));
    expect(result("tiktok")).toBeEmptyDOMElement();
  });
});

describe("the saved test code warning", () => {
  it("shows on a card with a saved code, naming the brand and what it does", () => {
    expect.hasAssertions();
    renderForm();

    const warning = within(card("Meta")).getByTestId("ad-test-code-warning-meta");
    expect(warning).toHaveAttribute("role", "note");
    expect(warning).toHaveTextContent("all live events from your store go to Meta's Test Events");
    expect(warning.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(warning.querySelector("bdi")).toHaveTextContent("Meta");
  });

  it("is not there without a saved code, nor on the platforms that have none", () => {
    expect.hasAssertions();
    renderForm();

    expect(screen.queryByTestId("ad-test-code-warning-tiktok")).toBeNull();
    expect(screen.queryByTestId("ad-test-code-warning-snap")).toBeNull();
    expect(screen.queryByTestId("ad-test-code-warning-ga4")).toBeNull();
    expect(screen.queryByTestId("ad-test-code-warning-google_ads")).toBeNull();
  });

  it("is about what is SAVED: typing a code does not raise it, and it is there for TikTok too", () => {
    expect.hasAssertions();
    renderForm(en, [
      TIKTOK_NO_CODE,
      { ...META_WITH_CODE, testEventCode: null },
      view("snap"),
      view("ga4"),
      view("google_ads"),
    ]);
    fireEvent.change(within(card("TikTok")).getByLabelText(copy.testEventCode), {
      target: { value: "TYPED1" },
    });

    expect(screen.queryByTestId("ad-test-code-warning-tiktok")).toBeNull();
    cleanup();
    renderForm(en, [
      { ...TIKTOK_NO_CODE, testEventCode: "TT123" },
      view("meta"),
      view("snap"),
      view("ga4"),
      view("google_ads"),
    ]);
    expect(screen.getByTestId("ad-test-code-warning-tiktok")).toHaveTextContent(
      "TikTok's Test Events",
    );
  });

  it("is said in Egyptian Arabic in the Arabic dictionary, brand name unchanged and isolated", () => {
    expect.hasAssertions();
    renderForm(ar);

    const warning = screen.getByTestId("ad-test-code-warning-meta");
    expect(warning).toHaveTextContent(
      ar.adPlatformsSettings.testSavedCodeWarning.split("{platform}")[0]!,
    );
    expect(warning.textContent).not.toContain("{platform}");
    expect(warning.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(warning.querySelector("bdi")).toHaveTextContent("Meta");
  });
});

describe("Arabic and logical CSS", () => {
  it("takes the button and the results from the Arabic dictionary, brand names isolated", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue({
      status: "done",
      platform: "tiktok",
      result: { platform: "tiktok", status: "rejected", vendorStatus: 400, sentAt: SENT_AT },
    });
    renderForm(ar);

    fireEvent.click(testButton("TikTok", ar));

    await waitFor(() => expect(result("tiktok")).toHaveTextContent("رفض الحدث التجريبي"));
    const brand = result("tiktok").querySelector("bdi[dir='auto']");
    expect(brand).toHaveTextContent("TikTok");
    expect(result("tiktok").querySelector("bdi[dir='ltr']")).toHaveTextContent("400");
    expect(result("tiktok").textContent).not.toContain("{");
  });

  it("uses no physical-side classes in the new markup", async () => {
    expect.hasAssertions();
    testAction.mockResolvedValue({
      status: "done",
      platform: "ga4",
      result: {
        platform: "ga4",
        status: "rejected",
        vendorStatus: 200,
        messages: ["a: b"],
        sentAt: SENT_AT,
      },
    });
    const { container } = renderForm();
    fireEvent.click(testButton("Google Analytics 4"));
    await waitFor(() => expect(within(result("ga4")).getByRole("list")).toBeInTheDocument());

    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
    expect(classes.filter((cls) => /^(?:[\w-]+:)*text-(left|right)$/.test(cls))).toEqual([]);
  });
});

describe("what is never in the page", () => {
  it("shows no token, no sealed value, no payload and no raw API text after a test", async () => {
    expect.hasAssertions();
    // A hostile double: even if the action's state carried the API's own text, the page only renders its own copy.
    testAction.mockResolvedValue({
      status: "failed",
      platform: "meta",
      reason: "unexpected",
      message: "Bearer EAAB-super-secret-token-123",
      payload: { data: [{ user_data: { em: ["hash"] } }] },
    } as unknown as AdPlatformTestState);
    renderForm();

    fireEvent.click(testButton("Meta"));

    await waitFor(() => expect(result("meta")).toHaveTextContent(en.formErrors.unexpected));
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("EAAB-super-secret-token-123");
    expect(text).not.toContain("user_data");
    expect(document.body.innerHTML).not.toContain("EAAB-super-secret-token-123");
    // The saved token is still only its last four digits.
    expect(within(card("Meta")).getByTestId("ad-token-meta")).toHaveTextContent("1234");
  });
});

describe("the feature's client components never import the server-only API client", () => {
  const dir = join(process.cwd(), "src", "components", "settings");
  const files = [
    "ad-platforms-form.tsx",
    "ad-platform-test-event.tsx",
    "ad-platform-remove-token-dialog.tsx",
  ];

  it.each(files)("%s: any @/lib/api import is `import type`", (file) => {
    expect.hasAssertions();
    const source = readFileSync(join(dir, file), "utf8");

    expect(source.trimStart().startsWith('"use client"')).toBe(true);
    // `import type` and `export type` are erased; anything else from lib/api/* would drag `next/headers` into
    // the browser bundle (and `next build` refuses it). Shared values live in `@/lib/ad-platforms-model`.
    const valueImportOfApi =
      /^\s*(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+["'](?:@\/lib\/api\/|(?:\.\.?\/)+(?:[\w-]+\/)*lib\/api\/)/m;
    expect(source).not.toMatch(valueImportOfApi);
    expect(source).not.toMatch(/^\s*import\s+["'][^"']*lib\/api\//m);
  });
});
