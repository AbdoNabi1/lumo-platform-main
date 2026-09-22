import { describe, expect, it } from "vitest";
import { NodeTokenPort } from "./node-token-port";

describe("NodeTokenPort (G-72)", () => {
  it("generates a 32-byte (64 hex char) raw token", () => {
    const port = new NodeTokenPort();
    const raw = port.generateRaw();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different token on every call", () => {
    const port = new NodeTokenPort();
    expect(port.generateRaw()).not.toBe(port.generateRaw());
  });

  it("hashes deterministically", () => {
    const port = new NodeTokenPort();
    const raw = port.generateRaw();
    expect(port.hash(raw)).toBe(port.hash(raw));
  });

  it("hash is a 64-char hex SHA-256 digest, distinct from the input", () => {
    const port = new NodeTokenPort();
    const raw = port.generateRaw();
    const hashed = port.hash(raw);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toBe(raw);
  });

  it("different raw tokens hash differently", () => {
    const port = new NodeTokenPort();
    expect(port.hash(port.generateRaw())).not.toBe(port.hash(port.generateRaw()));
  });
});
