import { describe, expect, it } from "vitest";
import {
  STOP_KEYWORDS,
  applyConsent,
  canSend,
  initialConsentState,
  isStopKeyword,
  type ConsentState,
} from "./consent";

const granted: ConsentState = {
  whatsappMarketing: "granted",
  whatsappTransactional: "allowed",
  emailMarketing: "granted",
};

describe("initialConsentState", () => {
  it("starts everything unknown", () => {
    expect.hasAssertions();
    expect(initialConsentState()).toEqual({
      whatsappMarketing: "unknown",
      whatsappTransactional: "unknown",
      emailMarketing: "unknown",
    });
  });

  it("returns a fresh object each call", () => {
    expect.hasAssertions();
    expect(initialConsentState()).not.toBe(initialConsentState());
  });
});

describe("canSend", () => {
  it("denies WhatsApp utility on a new state (transactional is unknown)", () => {
    expect.hasAssertions();
    expect(canSend(initialConsentState(), "whatsapp", "utility")).toBe(false);
    expect(canSend(initialConsentState(), "whatsapp", "transactional")).toBe(false);
    expect(canSend(initialConsentState(), "whatsapp", "authentication")).toBe(false);
  });

  it("allows WhatsApp utility/transactional/authentication only when transactional is allowed", () => {
    expect.hasAssertions();
    const s = applyConsent(initialConsentState(), {
      channel: "whatsapp",
      purpose: "transactional",
      action: "grant",
      source: "admin",
    }).state;
    expect(canSend(s, "whatsapp", "utility")).toBe(true);
    expect(canSend(s, "whatsapp", "transactional")).toBe(true);
    expect(canSend(s, "whatsapp", "authentication")).toBe(true);
    expect(canSend(s, "whatsapp", "marketing")).toBe(false);
  });

  it("denies WhatsApp utility when transactional is revoked", () => {
    expect.hasAssertions();
    expect(canSend({ ...granted, whatsappTransactional: "revoked" }, "whatsapp", "utility")).toBe(
      false,
    );
  });

  it("requires a marketing grant for WhatsApp marketing", () => {
    expect.hasAssertions();
    expect(canSend(granted, "whatsapp", "marketing")).toBe(true);
    expect(canSend({ ...granted, whatsappMarketing: "unknown" }, "whatsapp", "marketing")).toBe(
      false,
    );
    expect(canSend({ ...granted, whatsappMarketing: "revoked" }, "whatsapp", "marketing")).toBe(
      false,
    );
  });

  it("always allows transactional-class email", () => {
    expect.hasAssertions();
    const revoked: ConsentState = {
      whatsappMarketing: "revoked",
      whatsappTransactional: "revoked",
      emailMarketing: "revoked",
    };
    expect(canSend(revoked, "email", "transactional")).toBe(true);
    expect(canSend(revoked, "email", "utility")).toBe(true);
    expect(canSend(revoked, "email", "authentication")).toBe(true);
    expect(canSend(initialConsentState(), "email", "transactional")).toBe(true);
  });

  it("requires a marketing grant for email marketing", () => {
    expect.hasAssertions();
    expect(canSend(granted, "email", "marketing")).toBe(true);
    expect(canSend({ ...granted, emailMarketing: "unknown" }, "email", "marketing")).toBe(false);
    expect(canSend({ ...granted, emailMarketing: "revoked" }, "email", "marketing")).toBe(false);
  });
});

describe("applyConsent", () => {
  it("grant transactional makes WhatsApp utility sendable and reports the change", () => {
    expect.hasAssertions();
    const r = applyConsent(initialConsentState(), {
      channel: "whatsapp",
      purpose: "transactional",
      action: "grant",
      source: "checkout",
    });
    expect(r.state).toEqual({
      whatsappMarketing: "unknown",
      whatsappTransactional: "allowed",
      emailMarketing: "unknown",
    });
    expect(r.changed).toEqual([{ channel: "whatsapp", purpose: "transactional", action: "grant" }]);
    expect(canSend(r.state, "whatsapp", "utility")).toBe(true);
  });

  it("a grant never changes the other purpose", () => {
    expect.hasAssertions();
    const r = applyConsent(initialConsentState(), {
      channel: "whatsapp",
      purpose: "marketing",
      action: "grant",
      source: "admin",
    });
    expect(r.state.whatsappMarketing).toBe("granted");
    expect(r.state.whatsappTransactional).toBe("unknown");
    expect(r.changed).toEqual([{ channel: "whatsapp", purpose: "marketing", action: "grant" }]);
  });

  it("STOP keyword from a granted state revokes BOTH WhatsApp purposes", () => {
    expect.hasAssertions();
    const r = applyConsent(granted, {
      channel: "whatsapp",
      purpose: "marketing",
      action: "revoke",
      source: "inbound_keyword",
    });
    expect(r.state).toEqual({
      whatsappMarketing: "revoked",
      whatsappTransactional: "revoked",
      emailMarketing: "granted",
    });
    expect(r.changed).toHaveLength(2);
    expect(r.changed).toEqual([
      { channel: "whatsapp", purpose: "marketing", action: "revoke" },
      { channel: "whatsapp", purpose: "transactional", action: "revoke" },
    ]);
    expect(canSend(r.state, "whatsapp", "utility")).toBe(false);
  });

  it("a duplicate STOP changes nothing", () => {
    expect.hasAssertions();
    const first = applyConsent(granted, {
      channel: "whatsapp",
      purpose: "marketing",
      action: "revoke",
      source: "inbound_keyword",
    });
    const second = applyConsent(first.state, {
      channel: "whatsapp",
      purpose: "marketing",
      action: "revoke",
      source: "inbound_keyword",
    });
    expect(second.changed).toHaveLength(0);
    expect(second.state).toEqual(first.state);
  });

  it("STOP from an unknown state moves both purposes to revoked and lists both", () => {
    expect.hasAssertions();
    const r = applyConsent(initialConsentState(), {
      channel: "whatsapp",
      purpose: "marketing",
      action: "revoke",
      source: "inbound_keyword",
    });
    expect(r.state.whatsappMarketing).toBe("revoked");
    expect(r.state.whatsappTransactional).toBe("revoked");
    expect(r.changed).toHaveLength(2);
  });

  it("STOP only lists the purpose that actually changed", () => {
    expect.hasAssertions();
    const r = applyConsent(
      { ...granted, whatsappMarketing: "revoked" },
      { channel: "whatsapp", purpose: "marketing", action: "revoke", source: "inbound_keyword" },
    );
    expect(r.changed).toEqual([
      { channel: "whatsapp", purpose: "transactional", action: "revoke" },
    ]);
  });

  it("an admin marketing revoke leaves transactional untouched", () => {
    expect.hasAssertions();
    const r = applyConsent(granted, {
      channel: "whatsapp",
      purpose: "marketing",
      action: "revoke",
      source: "admin",
    });
    expect(r.state.whatsappMarketing).toBe("revoked");
    expect(r.state.whatsappTransactional).toBe("allowed");
    expect(r.changed).toEqual([{ channel: "whatsapp", purpose: "marketing", action: "revoke" }]);
  });

  it("an admin transactional revoke leaves marketing untouched", () => {
    expect.hasAssertions();
    const r = applyConsent(granted, {
      channel: "whatsapp",
      purpose: "transactional",
      action: "revoke",
      source: "api",
    });
    expect(r.state.whatsappTransactional).toBe("revoked");
    expect(r.state.whatsappMarketing).toBe("granted");
  });

  it("grant then revoke ends revoked; revoke then grant ends granted", () => {
    expect.hasAssertions();
    const ev = (action: "grant" | "revoke") =>
      ({ channel: "whatsapp", purpose: "marketing", action, source: "admin" }) as const;
    const a = applyConsent(applyConsent(initialConsentState(), ev("grant")).state, ev("revoke"));
    expect(a.state.whatsappMarketing).toBe("revoked");
    expect(a.changed).toHaveLength(1);
    const b = applyConsent(applyConsent(initialConsentState(), ev("revoke")).state, ev("grant"));
    expect(b.state.whatsappMarketing).toBe("granted");
    expect(b.changed).toHaveLength(1);
  });

  it("re-granting an already granted purpose reports no change", () => {
    expect.hasAssertions();
    const r = applyConsent(granted, {
      channel: "whatsapp",
      purpose: "marketing",
      action: "grant",
      source: "import",
    });
    expect(r.changed).toEqual([]);
    expect(r.state).toEqual(granted);
  });

  it("email marketing grant/revoke only touches emailMarketing", () => {
    expect.hasAssertions();
    const g = applyConsent(initialConsentState(), {
      channel: "email",
      purpose: "marketing",
      action: "grant",
      source: "import",
    });
    expect(g.state).toEqual({ ...initialConsentState(), emailMarketing: "granted" });
    expect(g.changed).toEqual([{ channel: "email", purpose: "marketing", action: "grant" }]);
    const r = applyConsent(g.state, {
      channel: "email",
      purpose: "marketing",
      action: "revoke",
      source: "api",
    });
    expect(r.state.emailMarketing).toBe("revoked");
  });

  it("email transactional events change nothing (always allowed)", () => {
    expect.hasAssertions();
    const r = applyConsent(granted, {
      channel: "email",
      purpose: "transactional",
      action: "revoke",
      source: "admin",
    });
    expect(r.state).toEqual(granted);
    expect(r.changed).toEqual([]);
  });

  it("an email STOP keyword does not touch WhatsApp", () => {
    expect.hasAssertions();
    const r = applyConsent(granted, {
      channel: "email",
      purpose: "marketing",
      action: "revoke",
      source: "inbound_keyword",
    });
    expect(r.state.whatsappTransactional).toBe("allowed");
    expect(r.state.emailMarketing).toBe("revoked");
  });

  it("does not mutate the input state", () => {
    expect.hasAssertions();
    const input: ConsentState = { ...granted };
    applyConsent(input, {
      channel: "whatsapp",
      purpose: "marketing",
      action: "revoke",
      source: "inbound_keyword",
    });
    expect(input).toEqual(granted);
  });
});

describe("isStopKeyword", () => {
  it("exposes the documented keyword list", () => {
    expect.hasAssertions();
    expect(STOP_KEYWORDS).toEqual([
      "stop",
      "unsubscribe",
      "الغاء",
      "إلغاء",
      "ايقاف",
      "إيقاف",
      "توقف",
    ]);
  });

  it.each([
    ["stop"],
    [" STOP "],
    ["Stop"],
    ["unsubscribe"],
    ["UNSUBSCRIBE\n"],
    ["إلغاء"],
    ["الغاء"],
    ["ايقاف"],
    ["إيقاف"],
    ["توقف"],
    ["توقّف"],
    ["الـغـاء"],
    ["إلغاءٌ"],
  ])("treats %j as a stop keyword", (text) => {
    expect.hasAssertions();
    expect(isStopKeyword(text)).toBe(true);
  });

  it.each([
    ["please stop"],
    ["stop it"],
    ["stopping"],
    [""],
    ["   "],
    ["hello"],
    ["لا تتوقف"],
    ["stop."],
  ])("does not treat %j as a stop keyword", (text) => {
    expect.hasAssertions();
    expect(isStopKeyword(text)).toBe(false);
  });
});
