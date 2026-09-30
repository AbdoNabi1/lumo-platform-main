import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Railway config-as-code files are the deploy. Nothing checked them: a review mutated the
 * worker's `startCommand` to `src/api.ts` and every test stayed green — Railway would then have run
 * a second API where the worker belongs, with no consumer and no outbox relay, and reported healthy.
 *
 * Both files run from the runtime image, whose WORKDIR is `/app/apps/runtime`, so a relative
 * `src/…` path must exist under `apps/runtime`.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

interface RailwayConfig {
  readonly build: { readonly builder: string; readonly dockerfilePath: string };
  readonly deploy: {
    readonly startCommand: string;
    readonly preDeployCommand?: string;
    readonly healthcheckPath?: string;
  };
}

function railway(name: string): RailwayConfig {
  return JSON.parse(
    readFileSync(join(ROOT, "infrastructure/railway", name), "utf8"),
  ) as RailwayConfig;
}

describe("the runtime image runs from apps/runtime", () => {
  it("has WORKDIR /app/apps/runtime, which every relative src/ path below depends on", () => {
    const dockerfile = readFileSync(join(ROOT, "infrastructure/docker/runtime.Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^WORKDIR \/app\/apps\/runtime$/m);
  });
});

describe("worker.railway.json", () => {
  const worker = railway("worker.railway.json");

  it("builds the runtime image", () => {
    expect(worker.build.builder).toBe("DOCKERFILE");
    expect(worker.build.dockerfilePath).toBe("infrastructure/docker/runtime.Dockerfile");
    expect(existsSync(join(ROOT, worker.build.dockerfilePath))).toBe(true);
  });

  it("starts the WORKER — not the API", () => {
    expect(worker.deploy.startCommand).toBe("node --import tsx src/worker.ts");
    expect(existsSync(join(ROOT, "apps/runtime/src/worker.ts"))).toBe(true);
  });

  it("provisions every topic before each deploy, so a failure blocks the deploy", () => {
    expect(worker.deploy.preDeployCommand).toBe(
      "cd /app/apps/runtime && node --import tsx src/provision-topics.ts",
    );
    expect(existsSync(join(ROOT, "apps/runtime/src/provision-topics.ts"))).toBe(true);
  });

  it("is health-checked on the path the worker's health server answers", () => {
    expect(worker.deploy.healthcheckPath).toBe("/healthz");
    const server = readFileSync(join(ROOT, "apps/runtime/src/health-server.ts"), "utf8");
    expect(server).toContain('url === "/healthz"');
  });
});

describe("runtime-api.railway.json", () => {
  it("starts the API, so the two services cannot be swapped", () => {
    expect(railway("runtime-api.railway.json").deploy.startCommand).toBe(
      "node --import tsx src/api.ts",
    );
  });
});

/**
 * The ROOT `railway.json` is the one config Railway reads with no dashboard setting at all
 * ("Railway looks for `railway.toml` or `railway.json` files by default" — config-as-code
 * reference). It exists because three deploys in a row fell back to Railpack and failed with
 * `No start command detected`, which is what happens when the per-service config path is unset or
 * not picked up. It must stay byte-identical to the API's own config: two files that drift would
 * make a service's behaviour depend on whether its dashboard path happens to be set.
 */
describe("the root railway.json — the default any service picks up", () => {
  it("is identical to runtime-api.railway.json", () => {
    expect(readFileSync(join(ROOT, "railway.json"), "utf8")).toBe(
      readFileSync(join(ROOT, "infrastructure/railway/runtime-api.railway.json"), "utf8"),
    );
  });

  it("starts the API and migrates first, so a service with no config path still boots correctly", () => {
    const root = JSON.parse(readFileSync(join(ROOT, "railway.json"), "utf8")) as RailwayConfig;
    expect(root.build.dockerfilePath).toBe("infrastructure/docker/runtime.Dockerfile");
    expect(root.deploy.startCommand).toBe("node --import tsx src/api.ts");
    expect(root.deploy.preDeployCommand).toBe(
      "cd /app/packages/db && pnpm exec prisma migrate deploy",
    );
  });

  it("does NOT start the worker: a worker service that forgets its config path must not become a second API silently", () => {
    // Not a redundant assertion — it is the whole hazard of having a root default. The worker's
    // own config is the only place its start command lives; see README section 8.
    const worker = railway("worker.railway.json");
    const root = JSON.parse(readFileSync(join(ROOT, "railway.json"), "utf8")) as RailwayConfig;
    expect(root.deploy.startCommand).not.toBe(worker.deploy.startCommand);
  });
});
