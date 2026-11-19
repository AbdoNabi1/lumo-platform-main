import { describe, expect, it } from "vitest";
import { siteOrigin } from "./site-origin";

describe("siteOrigin (robots and sitemap URLs)", () => {
  it.each([
    ["shop.example", "production", "https://shop.example"],
    ["Shop.Example:8443", "production", "https://shop.example:8443"],
    ["localhost:3000", "development", "http://localhost:3000"],
    ["127.0.0.1:3000", "development", "http://127.0.0.1:3000"],
    ["localhost:3000", "production", "https://localhost:3000"],
    ["localhost:3000", undefined, "https://localhost:3000"],
    ["shop.example", "development", "https://shop.example"],
    ["shop.example:65535", "production", "https://shop.example:65535"],
  ])("%s in %s → %s", (host, env, origin) => expect(siteOrigin(host, env)).toBe(origin));

  it.each([
    null,
    "",
    "evil.example/x",
    "a b",
    "evil..example",
    "shop.example:99999999",
    "shop.example:65536",
    "shop.example:",
    "user@shop.example",
    "shop.example\n",
    "shop.example?x",
    "shop.example#x",
    "[::1]:3000",
    "shop.example\\x",
    "<shop>",
    "shop&example",
    'shop"example',
  ])("refuses %j", (host) => expect(siteOrigin(host as string | null, "production")).toBeNull());
});
