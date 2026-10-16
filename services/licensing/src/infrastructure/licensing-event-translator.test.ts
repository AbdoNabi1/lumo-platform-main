import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LICENSING_PUBLISHED_EVENTS } from "./licensing-event-translator";

/**
 * `LicensingEventTranslator` builds its type dynamically — `licensing.${family}.${action}` — and
 * `LicensingChanged.action` is a bare `string`, so the compiler cannot list what can be emitted. The
 * list beside it was hand-written. The runtime's Kafka topic inventory provisions one topic per entry,
 * and an event whose type has no topic stalls the outbox relay (G-80), so the list must match the
 * domain in BOTH directions: nothing raised and unlisted, nothing listed and never raised.
 *
 * Every aggregate raises through a private `raise(action, …)` that fixes its `family` literal. Actions
 * arrive as a literal first argument to `<something>.raise("…")` — `this.raise` in methods, or
 * `plan.raise`/`coupon.raise`… from `static create` — or as the literal last argument of
 * `this.transition(to, eventId, occurredAt, "…")`, whose own body forwards it to `raise`. A call site
 * that fits neither shape fails the "no unreadable call site" test, so the scan cannot silently miss one.
 */
const DOMAIN = fileURLToPath(new URL("../domain/", import.meta.url));

interface Scan {
  readonly raised: ReadonlySet<string>;
  readonly unreadable: readonly string[];
}

function scanDomain(): Scan {
  const raised = new Set<string>();
  const unreadable: string[] = [];
  for (const name of readdirSync(DOMAIN)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const src = readFileSync(`${DOMAIN}${name}`, "utf8");
    const family = /family:\s*"([a-z_]+)"/.exec(src)?.[1];
    if (family === undefined) continue;
    for (const call of src.matchAll(/\b[a-zA-Z]+\.raise\(\s*([^,)]+)/g)) {
      const arg = (call[1] ?? "").trim();
      const literal = /^"([a-z_]+)"$/.exec(arg)?.[1];
      if (literal !== undefined) raised.add(`licensing.${family}.${literal}`);
      // The one sanctioned non-literal: a `transition` helper forwarding its own `action` parameter.
      else if (arg !== "action") unreadable.push(`${name}: raise(${arg}, …)`);
    }
    for (const call of src.matchAll(/this\.transition\(([^;]*?)\);/gs)) {
      const args = (call[1] ?? "").split(",").map((a) => a.trim());
      if (args.length < 4) continue;
      const last = args[args.length - 1] ?? "";
      const literal = /^"([a-z_]+)"$/.exec(last)?.[1];
      if (literal !== undefined) raised.add(`licensing.${family}.${literal}`);
      else unreadable.push(`${name}: transition(…, ${last})`);
    }
  }
  return { raised, unreadable };
}

describe("LICENSING_PUBLISHED_EVENTS matches what the Licensing domain can raise", () => {
  it("found the domain it means to scan", () => {
    // Guards the guard: a moved directory would make the equality below compare two empty sets.
    expect(scanDomain().raised.size).toBeGreaterThanOrEqual(30);
  });

  it("has no call site the scan cannot read", () => {
    expect(scanDomain().unreadable).toEqual([]);
  });

  it("lists every raised type, and no type that is never raised", () => {
    expect([...scanDomain().raised].sort()).toEqual([...LICENSING_PUBLISHED_EVENTS].sort());
  });
});
