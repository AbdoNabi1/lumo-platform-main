import { describe, expect, it } from "vitest";
import type { PaymentProvider } from "@platform/contracts";
import {
  PaymentProviderRegistry,
  type OnSessionOnlyRegistration,
  type ProviderRegistration,
} from "./provider-registry";

const CAPS: OnSessionOnlyRegistration["capabilities"] = {
  settlesAtPayTime: false,
  deliversWebhooks: true,
  requiresMerchantCredentials: false,
  chargesOffSession: false,
};

const noop = {} as PaymentProvider;

function reg(
  overrides: Partial<OnSessionOnlyRegistration> & { key: string },
): ProviderRegistration {
  return { capabilities: CAPS, backing: "real", create: () => noop, ...overrides };
}

describe("PaymentProviderRegistry", () => {
  it("looks a registration up by its key and knows nothing else about it", () => {
    const registry = PaymentProviderRegistry.from([reg({ key: "one" }), reg({ key: "two" })]);

    expect(registry.get("one")?.key).toBe("one");
    expect(registry.has("two")).toBe(true);
    expect(registry.has("three")).toBe(false);
    expect(registry.get("three")).toBeUndefined();
    expect(registry.list().map((r) => r.key)).toEqual(["one", "two"]);
  });

  it("refuses a duplicate key — a second registration must not silently replace the first", () => {
    expect(() => PaymentProviderRegistry.from([reg({ key: "one" }), reg({ key: "one" })])).toThrow(
      /already registered/,
    );
  });

  it.each(["", "Has Space", "UPPER", "a/b", "x".repeat(65), "-lead"])(
    "refuses the malformed key %j",
    (key) => {
      expect(() => PaymentProviderRegistry.from([reg({ key })])).toThrow(/key/);
    },
  );

  it("refuses a credentialed provider that declares no credential fields, and the reverse", () => {
    expect(() =>
      PaymentProviderRegistry.from([
        reg({ key: "a", capabilities: { ...CAPS, requiresMerchantCredentials: true } }),
      ]),
    ).toThrow(/credentialFields/);
    expect(() =>
      PaymentProviderRegistry.from([reg({ key: "b", credentialFields: ["apiKey"] })]),
    ).toThrow(/credentialFields/);
  });

  it("lists as default-enabled only the providers that declare it", () => {
    const registry = PaymentProviderRegistry.from([
      reg({ key: "a", enabledByDefault: true }),
      reg({ key: "b" }),
    ]);

    expect(registry.defaultEnabled()).toEqual(["a"]);
  });

  it("has no operation that picks a provider without being told its key", () => {
    // WP-13 decision 3 and its trap: the shopper's explicit choice is the ONLY selector. A registry
    // makes "pick the best one" one method away; if a method like that is added, this fails and the
    // author has to read this comment. Look-ups by key, enumeration and declared defaults for the
    // OFFERED set are the whole surface.
    const methods = Object.getOwnPropertyNames(PaymentProviderRegistry.prototype)
      .filter((name) => name !== "constructor")
      .sort();

    expect(methods).toEqual(["defaultEnabled", "get", "has", "list"]);
  });
});
