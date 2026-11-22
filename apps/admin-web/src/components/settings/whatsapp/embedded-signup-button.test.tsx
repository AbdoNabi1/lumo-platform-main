import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { EmbeddedSignupButton } from "./embedded-signup-button";

const action = vi.hoisted(() => vi.fn());
vi.mock("@/app/settings/whatsapp/actions", () => ({ connectWhatsAppAction: action }));

const signup = { appId: "1234567890", configId: "cfg-42", graphApiVersion: "v24.0" };

interface LoginOptions {
  config_id: string;
  response_type: string;
  override_default_response_type: boolean;
  extras: Record<string, unknown>;
}
type LoginCallback = (response: { authResponse?: { code?: unknown } | null }) => void;

const fb = {
  init: vi.fn(),
  login: vi.fn<(cb: LoginCallback, options: LoginOptions) => void>(),
};
const w = window as unknown as { FB?: typeof fb };

function metaMessage(payload: unknown, origin = "https://www.facebook.com") {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin }));
  });
}
const finish = (waba = "100200300", phone = "400500600") => ({
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH",
  data: { waba_id: waba, phone_number_id: phone },
  version: "3",
});

/** Dictionary copy is split around brand `<bdi>`s, so match the paragraph by its whole text. */
const copyText = (text: string) => (_content: string, element: Element | null) =>
  element?.tagName === "P" && element.textContent === text;

function loginCallback(): LoginCallback {
  const call = fb.login.mock.calls.at(-1);
  if (call === undefined) throw new Error("FB.login was not called");
  return call[0];
}
function returnCode(code: unknown) {
  act(() => loginCallback()({ authResponse: code === null ? null : { code } }));
}

async function startAttempt(t: Dictionary = en, label = "Connect WhatsApp") {
  const view = render(<EmbeddedSignupButton signup={signup} label={label} t={t} />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(fb.login).toHaveBeenCalled());
  return view;
}
async function nextAttempt(label = "Connect WhatsApp") {
  const before = fb.login.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(fb.login.mock.calls.length).toBe(before + 1));
}

beforeEach(() => {
  expect.hasAssertions();
  fb.init.mockReset();
  fb.login.mockReset();
  action.mockReset().mockResolvedValue({ status: "success" });
  w.FB = fb;
});
afterEach(() => {
  delete w.FB;
  document.getElementById("facebook-jssdk")?.remove();
});

describe("Embedded Signup v4 — the SDK calls", () => {
  it("initialises with the app id and the Graph version from the DTO, and logs in with the v4 options", async () => {
    expect.hasAssertions();
    await startAttempt();
    expect(fb.init).toHaveBeenCalledWith({ appId: "1234567890", version: "v24.0", xfbml: false });
    const options = fb.login.mock.calls[0]![1];
    expect(options).toEqual({
      config_id: "cfg-42",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {} },
    });
    expect(JSON.stringify(options)).not.toContain("sessionInfoVersion");
    expect(JSON.stringify(options)).not.toContain("featureType");
  });

  it("uses whatever Graph version the platform reports", async () => {
    expect.hasAssertions();
    render(
      <EmbeddedSignupButton
        signup={{ ...signup, graphApiVersion: "v25.0" }}
        label="Connect WhatsApp"
        t={en}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
    await waitFor(() => expect(fb.init).toHaveBeenCalled());
    expect(fb.init.mock.calls[0]![0].version).toBe("v25.0");
  });

  it("puts the brand name in its own bdi", async () => {
    expect.hasAssertions();
    render(<EmbeddedSignupButton signup={signup} label="Connect WhatsApp" t={en} />);
    const brand = screen.getByText("WhatsApp");
    expect(brand.tagName).toBe("BDI");
    expect(brand).toHaveAttribute("dir", "auto");
  });
});

describe("Embedded Signup v4 — completing", () => {
  it("accepts a JSON-string event, code after ids: the action runs once with the three values", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage(finish());
    expect(action).not.toHaveBeenCalled();
    returnCode("the-code");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith({
      code: "the-code",
      wabaId: "100200300",
      phoneNumberId: "400500600",
    });
  });

  it("code before ids: the action runs once, when the ids arrive", async () => {
    expect.hasAssertions();
    await startAttempt();
    returnCode("early-code");
    expect(action).not.toHaveBeenCalled();
    metaMessage(finish("11", "22"));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith({ code: "early-code", wabaId: "11", phoneNumberId: "22" });
  });

  it("a repeated FINISH (and a repeated callback) is still one action call", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage(finish());
    metaMessage(finish());
    returnCode("c1");
    metaMessage(finish());
    returnCode("c1");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("accepts a 1024-character code", async () => {
    expect.hasAssertions();
    const long = "c".repeat(1024);
    await startAttempt();
    metaMessage(finish());
    returnCode(long);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0]![0].code).toHaveLength(1024);
  });

  it("accepts the second Meta origin", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage(finish(), "https://web.facebook.com");
    returnCode("c");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("shows the connected line after a successful action", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage(finish());
    returnCode("c");
    expect(
      await screen.findByText(copyText(en.whatsappSettings.signupConnected)),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeDisabled();
  });

  it("shows the action's localised message when the connect is refused, and lets the merchant retry", async () => {
    expect.hasAssertions();
    action.mockResolvedValue({
      status: "error",
      message: en.whatsappSettings.errors.PHONE_IN_USE,
    });
    await startAttempt();
    metaMessage(finish());
    returnCode("c");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappSettings.errors.PHONE_IN_USE,
    );
    expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeEnabled();
  });

  it("a rejected action promise shows the generic copy", async () => {
    expect.hasAssertions();
    action.mockRejectedValue(new Error("network"));
    await startAttempt();
    metaMessage(finish());
    returnCode("c");
    expect(await screen.findByRole("alert")).toHaveTextContent(en.whatsappSettings.errors.generic);
  });
});

describe("Embedded Signup v4 — events that must not connect", () => {
  it.each([
    ["another origin", "https://evil.example"],
    ["a look-alike suffix", "https://www.facebook.com.evil.example"],
    ["a look-alike prefix", "https://evilwww.facebook.com"],
    ["plain http", "http://www.facebook.com"],
    ["a sibling Facebook host", "https://m.facebook.com"],
    ["an empty origin", ""],
  ])("ignores a FINISH from %s", async (_name, origin) => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage(finish(), origin);
    returnCode("c");
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
    // The attempt is still alive: the real event then completes it.
    metaMessage(finish());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("ignores malformed JSON without throwing", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage("{not json");
    metaMessage("");
    metaMessage("null");
    metaMessage('"text"');
    returnCode("c");
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a payload that is already an object (v4 sends a string)", async () => {
    expect.hasAssertions();
    await startAttempt();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: finish(), origin: "https://www.facebook.com" }),
      );
    });
    returnCode("c");
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
  });

  it("ignores another message type", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage({
      type: "SOMETHING_ELSE",
      event: "FINISH",
      data: { waba_id: "1", phone_number_id: "2" },
    });
    returnCode("c");
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
  });

  it("a FINISH without a phone number shows the unsupported copy and never connects", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "100" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This setup isn't supported. Use a number for the WhatsApp Business Platform.",
    );
    returnCode("c");
    metaMessage(finish());
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
  });

  it("FINISH_ONLY_WABA shows the unsupported copy and never connects", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_ONLY_WABA",
      data: { waba_id: "100" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappSettings.signupUnsupported,
    );
    returnCode("c");
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-decimal WABA id", { waba_id: "12a", phone_number_id: "22" }],
    ["a non-decimal phone id", { waba_id: "11", phone_number_id: "+22" }],
    ["an empty phone id", { waba_id: "11", phone_number_id: "" }],
    ["a numeric (non-string) id", { waba_id: 11, phone_number_id: 22 }],
    ["a 65-digit id", { waba_id: "1".repeat(65), phone_number_id: "22" }],
  ])("FINISH with %s is unsupported, never connected", async (_name, data) => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappSettings.signupUnsupported,
    );
    returnCode("c");
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
  });

  it("an ERROR event shows the setup-failed copy", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage({
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: { error_message: "provider text" },
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.whatsappSettings.signupFailed);
    expect(document.body).not.toHaveTextContent("provider text");
  });

  it("messages before any attempt are ignored", async () => {
    expect.hasAssertions();
    render(<EmbeddedSignupButton signup={signup} label="Connect WhatsApp" t={en} />);
    metaMessage(finish());
    metaMessage({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });
});

describe("Embedded Signup v4 — cancel and per-attempt reset", () => {
  it("CANCEL shows the cancel copy", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE" } });
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.whatsappSettings.signupCancelled,
    );
    expect(action).not.toHaveBeenCalled();
  });

  it("a login callback without a code (popup closed) shows the cancel copy", async () => {
    expect.hasAssertions();
    await startAttempt();
    returnCode(null);
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.whatsappSettings.signupCancelled,
    );
    expect(action).not.toHaveBeenCalled();
  });

  it("cancel, then a new attempt: the old ids and code never carry over", async () => {
    expect.hasAssertions();
    await startAttempt();
    metaMessage(finish("111", "222")); // attempt 1 captured ids …
    metaMessage({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} }); // … then cancelled
    expect(
      await screen.findByText(copyText(en.whatsappSettings.signupCancelled)),
    ).toBeInTheDocument();

    await nextAttempt();
    // The cancel copy is gone and the attempt starts clean.
    expect(
      screen.queryByText(copyText(en.whatsappSettings.signupCancelled)),
    ).not.toBeInTheDocument();
    returnCode("second-code");
    await act(async () => {});
    expect(action).not.toHaveBeenCalled(); // attempt 1's ids were cleared

    metaMessage(finish("333", "444"));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith({
      code: "second-code",
      wabaId: "333",
      phoneNumberId: "444",
    });
  });

  it("a stale callback from a cancelled attempt cannot complete the new one", async () => {
    expect.hasAssertions();
    await startAttempt();
    const staleCallback = loginCallback();
    metaMessage({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} });
    await nextAttempt();
    metaMessage(finish("5", "6"));
    act(() => staleCallback({ authResponse: { code: "stale" } }));
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
    returnCode("fresh");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0]![0].code).toBe("fresh");
  });

  it("a completed attempt can be followed by another one", async () => {
    expect.hasAssertions();
    action.mockResolvedValue({ status: "error", message: "nope" });
    await startAttempt();
    metaMessage(finish("1", "2"));
    returnCode("a");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");
    await nextAttempt();
    metaMessage(finish("3", "4"));
    returnCode("b");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[1]![0]).toEqual({ code: "b", wabaId: "3", phoneNumberId: "4" });
  });
});

describe("Embedded Signup v4 — loading the SDK", () => {
  beforeEach(() => {
    delete w.FB;
  });

  it("injects the SDK once, async, from the Facebook origin", async () => {
    expect.hasAssertions();
    render(<EmbeddedSignupButton signup={signup} label="Connect WhatsApp" t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
    const tag = await waitFor(() => {
      const found = document.getElementById("facebook-jssdk") as HTMLScriptElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    expect(tag.src).toBe("https://connect.facebook.net/en_US/sdk.js");
    expect(tag.async).toBe(true);
    expect(document.querySelectorAll("script#facebook-jssdk")).toHaveLength(1);
    expect(
      await screen.findByText(copyText(en.whatsappSettings.signupLoading)),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeDisabled();
    w.FB = fb;
    act(() => {
      tag.dispatchEvent(new Event("load"));
    });
    await waitFor(() => expect(fb.login).toHaveBeenCalledTimes(1));
  });

  it("an SDK load failure shows an error and a retry button, and the retry loads it again", async () => {
    expect.hasAssertions();
    render(<EmbeddedSignupButton signup={signup} label="Connect WhatsApp" t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
    const tag = await waitFor(() => {
      const found = document.getElementById("facebook-jssdk");
      expect(found).not.toBeNull();
      return found!;
    });
    act(() => {
      tag.dispatchEvent(new Event("error"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappSettings.signupLoadFailed,
    );
    expect(document.getElementById("facebook-jssdk")).toBeNull();
    expect(fb.login).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: en.whatsappSettings.signupRetry }));
    const retryTag = await waitFor(() => {
      const found = document.getElementById("facebook-jssdk");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(retryTag).not.toBe(tag);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    w.FB = fb;
    act(() => {
      retryTag.dispatchEvent(new Event("load"));
    });
    await waitFor(() => expect(fb.login).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: en.whatsappSettings.signupRetry }),
    ).not.toBeInTheDocument();
  });

  it("a script that loads without defining FB is a load failure", async () => {
    expect.hasAssertions();
    render(<EmbeddedSignupButton signup={signup} label="Connect WhatsApp" t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
    const tag = await waitFor(() => {
      const found = document.getElementById("facebook-jssdk");
      expect(found).not.toBeNull();
      return found!;
    });
    act(() => {
      tag.dispatchEvent(new Event("load"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.whatsappSettings.signupLoadFailed,
    );
  });
});

describe("Embedded Signup v4 — lifecycle", () => {
  it("removes the message listener on unmount", async () => {
    expect.hasAssertions();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = await startAttempt();
    const registered = add.mock.calls.find((call) => call[0] === "message")?.[1];
    expect(registered).toBeDefined();
    returnCode("c");
    view.unmount();
    expect(remove.mock.calls.some((call) => call[0] === "message" && call[1] === registered)).toBe(
      true,
    );
    metaMessage(finish());
    await act(async () => {});
    expect(action).not.toHaveBeenCalled();
    add.mockRestore();
    remove.mockRestore();
  });

  it("renders Arabic copy and keeps the brand isolated in RTL", async () => {
    expect.hasAssertions();
    await startAttempt(ar, ar.whatsappSettings.connect);
    metaMessage({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(ar.whatsappSettings.signupCancelled);
    const button = screen.getByRole("button", { name: ar.whatsappSettings.connect });
    expect(button.querySelector("bdi")).toHaveAttribute("dir", "auto");
  });
});
