import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wave 2b2 (D45): a store's customer mail is sent ONLY through the store's own email connection. The
 * Notifications context therefore must not even know the platform's mail account: no `EmailSender`, no
 * platform From, no platform key. This is a structural guard next to the behavioural spy tests.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "testing" ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN = [
  "EmailSender",
  "onboarding@resend.dev",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "platformFrom",
  "DEFAULT_PLATFORM_FROM",
  "EmailDeliveryPort",
  "SenderDomain",
  "sender_domains",
];

describe("no platform mail account in the Notifications context (D45)", () => {
  const files = sources(join(import.meta.dirname));

  it("scans the real sources", () => {
    expect.hasAssertions();
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)("no production source mentions %s", (word) => {
    expect.hasAssertions();
    const offenders = files.filter((file) => readFileSync(file, "utf-8").includes(word));
    expect(offenders).toEqual([]);
  });

  it("the only way mail leaves is the store connection: StoreEmailDelivery is the sole StoreMailSender", () => {
    expect.hasAssertions();
    const implementers = files.filter((file) =>
      /implements\s+StoreMailSender/.test(readFileSync(file, "utf-8")),
    );
    expect(implementers.map((file) => file.replace(/\\/g, "/").split("/").pop())).toEqual([
      "store-email-delivery.ts",
    ]);
  });
});
