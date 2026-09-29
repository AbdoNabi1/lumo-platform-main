import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FINANCE_PUBLISHED_EVENTS } from "./finance-event-translator";

/**
 * The runtime's Kafka topic inventory provisions one topic per type in `FINANCE_PUBLISHED_EVENTS`, and
 * an event whose type has no topic stalls the outbox relay (G-80). So the list must be exactly what
 * the translator can emit — read from the translator's own `type:` literals, not restated by hand.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL("./finance-event-translator.ts", import.meta.url)),
  "utf8",
);

describe("FINANCE_PUBLISHED_EVENTS is exactly what FinanceEventTranslator emits", () => {
  it("every type the translator emits is listed, and nothing else is", () => {
    const emitted = [...SOURCE.matchAll(/\btype:\s*"([a-z0-9_.]+)"/g)].map((m) => m[1]);
    expect(emitted.length).toBeGreaterThan(0);
    expect([...new Set(emitted)].sort()).toEqual([...FINANCE_PUBLISHED_EVENTS].sort());
  });

  it("emits no dynamically built type the scan above could not see", () => {
    expect(SOURCE).not.toMatch(/type:\s*`/);
  });
});
