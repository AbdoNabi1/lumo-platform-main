import { describe, expect, it } from "vitest";
import { createMetaFetchHarness } from "./meta-fetch-harness";

describe("createMetaFetchHarness", () => {
  it("records Request and URL inputs and non-JSON bodies", async () => {
    expect.hasAssertions();
    const harness = createMetaFetchHarness([
      { status: 200, json: {} },
      { status: 200, json: {} },
    ]);
    await harness.fetchImpl(
      new Request("https://graph.facebook.com/request", {
        method: "POST",
        headers: { "X-Test": "request" },
      }),
      { body: "not json" },
    );
    await harness.fetchImpl(new URL("https://graph.facebook.com/url"));
    expect(harness.calls[0]).toMatchObject({
      url: "https://graph.facebook.com/request",
      method: "POST",
      headers: { "x-test": "request" },
      body: "not json",
    });
    expect(harness.calls[1]?.url).toBe("https://graph.facebook.com/url");
  });
  it("records a JSON body owned by a Request input and leaves its stream readable", async () => {
    expect.hasAssertions();
    const harness = createMetaFetchHarness([{ status: 200, json: {} }]);
    const request = new Request("https://graph.facebook.com/owned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1, nested: { b: [2] } }),
    });
    await harness.fetchImpl(request);
    expect(harness.calls[0]).toMatchObject({
      url: "https://graph.facebook.com/owned",
      method: "POST",
      body: { a: 1, nested: { b: [2] } },
    });
    expect(request.bodyUsed).toBe(false);
    expect(await request.json()).toEqual({ a: 1, nested: { b: [2] } });
  });
  it("records a non-JSON body owned by a Request input verbatim", async () => {
    expect.hasAssertions();
    const harness = createMetaFetchHarness([{ status: 200, json: {} }]);
    await harness.fetchImpl(
      new Request("https://graph.facebook.com/owned", { method: "POST", body: "plain text" }),
    );
    expect(harness.calls[0]?.body).toBe("plain text");
  });
  it("lets init.body override the body owned by a Request input", async () => {
    expect.hasAssertions();
    const harness = createMetaFetchHarness([{ status: 200, json: {} }]);
    await harness.fetchImpl(
      new Request("https://graph.facebook.com/owned", {
        method: "POST",
        body: JSON.stringify({ from: "request" }),
      }),
      { body: JSON.stringify({ from: "init" }) },
    );
    expect(harness.calls[0]?.body).toEqual({ from: "init" });
  });
  it("records a Request-owned body before throwing on an exhausted queue", async () => {
    expect.hasAssertions();
    const harness = createMetaFetchHarness([]);
    await expect(
      harness.fetchImpl(
        new Request("https://graph.facebook.com/owned", {
          method: "POST",
          body: JSON.stringify({ kept: true }),
        }),
      ),
    ).rejects.toThrow("harness exhausted");
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.body).toEqual({ kept: true });
  });
  it("records requests before consuming queued responses and exhausted calls", async () => {
    expect.hasAssertions();
    const harness = createMetaFetchHarness([
      { status: 201, json: { id: "1" } },
      { throw: new Error("offline") },
    ]);
    const response = await harness.fetchImpl("https://graph.facebook.com/v24.0/test", {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "1" });
    expect(harness.calls[0]?.url).toBe("https://graph.facebook.com/v24.0/test");
    expect(harness.calls[0]?.method).toBe("POST");
    expect(harness.calls[0]?.headers.authorization?.startsWith("Bearer ")).toBe(true);
    expect(harness.calls[0]?.body).toEqual({ a: 1 });
    await expect(harness.fetchImpl("https://graph.facebook.com/2")).rejects.toThrow("offline");
    await expect(harness.fetchImpl("https://graph.facebook.com/3")).rejects.toThrow(
      "harness exhausted",
    );
    expect(harness.calls).toHaveLength(3);
    expect(harness.calls[1]?.method).toBe("GET");
  });
});
