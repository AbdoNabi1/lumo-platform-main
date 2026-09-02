import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

function lastLoggedRecord(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  if (call === undefined) throw new Error("nothing was logged");
  return JSON.parse(call[0] as string) as Record<string, unknown>;
}

describe("logger redaction", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("redacts built-in sensitive keys by default, case- and separator-insensitively", () => {
    const logger = createLogger({ level: "info" });
    logger.info("login", {
      email: "alice@example.com",
      API_KEY: "k-1",
      refreshToken: "r-1",
      orderId: "o-1",
    });
    const record = lastLoggedRecord(spy);
    expect(record["email"]).toBe("[redacted]");
    expect(record["API_KEY"]).toBe("[redacted]");
    expect(record["refreshToken"]).toBe("[redacted]");
    expect(record["orderId"]).toBe("o-1");
  });

  it("redacts nested objects and arrays", () => {
    const logger = createLogger({ level: "info" });
    logger.info("event", { payload: { customer: { email: "a@b.co" }, items: [{ token: "t" }] } });
    const record = lastLoggedRecord(spy) as {
      payload: { customer: { email: string }; items: { token: string }[] };
    };
    expect(record.payload.customer.email).toBe("[redacted]");
    expect(record.payload.items[0]?.token).toBe("[redacted]");
  });

  it("merges caller-supplied keys with the defaults", () => {
    const logger = createLogger({ level: "info", redact: ["internalRef"] });
    logger.info("x", { internalRef: "ref-1", password: "p" });
    const record = lastLoggedRecord(spy);
    expect(record["internalRef"]).toBe("[redacted]");
    expect(record["password"]).toBe("[redacted]");
  });

  it("can disable the defaults explicitly", () => {
    const logger = createLogger({ level: "info", redactDefaults: false, redact: ["password"] });
    logger.info("x", { email: "a@b.co", password: "p" });
    const record = lastLoggedRecord(spy);
    expect(record["email"]).toBe("a@b.co");
    expect(record["password"]).toBe("[redacted]");
  });

  it("survives circular structures", () => {
    const logger = createLogger({ level: "info" });
    const node: Record<string, unknown> = { orderId: "o-1" };
    node["self"] = node;
    logger.info("x", { node });
    const record = lastLoggedRecord(spy) as { node: { orderId: string; self: string } };
    expect(record.node.orderId).toBe("o-1");
    expect(record.node.self).toBe("[redacted]");
  });
});
