import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthRegistry, type HealthReport } from "@platform/health";
import { startHealthServer, type MetricsSource } from "./health-server";

let server: Server | undefined;

afterEach(async () => {
  if (server?.listening) {
    server.close();
    await once(server, "close");
  }
  server = undefined;
});

async function serve(health: HealthRegistry, metrics?: MetricsSource): Promise<string> {
  server = startHealthServer(health, 0, metrics);
  if (!server.listening) await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
}

describe("startHealthServer", () => {
  it("answers /healthz with 200 while the event loop is alive", async () => {
    const base = await serve(new HealthRegistry());
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers /readyz with 200 and the report when every probe passes", async () => {
    const health = new HealthRegistry().register({ name: "db", probe: async () => undefined });
    const response = await fetch(`${await serve(health)}/readyz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "healthy",
      components: [{ name: "db", status: "healthy" }],
    });
  });

  it("answers /readyz with 503 when a critical probe fails", async () => {
    const health = new HealthRegistry().register({
      name: "db",
      probe: () => Promise.reject(new Error("connection refused")),
    });
    const response = await fetch(`${await serve(health)}/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unhealthy",
      components: [{ name: "db", status: "unhealthy", error: "connection refused" }],
    });
  });

  it("fails closed with 503 when running the probes itself throws", async () => {
    const broken = { run: () => Promise.reject(new Error("registry exploded")) };
    const response = await fetch(`${await serve(broken as unknown as HealthRegistry)}/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unhealthy",
      error: "Error: registry exploded",
    });
  });

  it("feeds each readiness report to the metrics source and serves /metrics", async () => {
    const reports: HealthReport[] = [];
    const metrics: MetricsSource = {
      render: () => "runtime_up 1\n",
      updateHealth: (report) => reports.push(report),
    };
    const base = await serve(new HealthRegistry(), metrics);

    await fetch(`${base}/readyz`);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.status).toBe("healthy");

    const response = await fetch(`${base}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; version=0.0.4");
    expect(await response.text()).toBe("runtime_up 1\n");
  });

  it("returns 404 for /metrics when no metrics source is wired, and for unknown routes", async () => {
    const base = await serve(new HealthRegistry());
    for (const path of ["/metrics", "/nope"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: "NOT_FOUND" });
    }
  });

  it("returns 404 for a non-GET request to a probe path", async () => {
    const response = await fetch(`${await serve(new HealthRegistry())}/healthz`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("logs a bind failure instead of crashing the host process", async () => {
    const first = await serve(new HealthRegistry());
    const port = Number(new URL(first).port);
    const errors = vi.fn();
    const clash = startHealthServer(new HealthRegistry(), port);
    clash.on("error", errors);
    await once(clash, "error");
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: "EADDRINUSE" }));
    expect(clash.listening).toBe(false);
  });
});
