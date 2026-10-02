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
describe("the root railway.json — what every service inherits", () => {
  const root = (): RailwayConfig =>
    JSON.parse(readFileSync(join(ROOT, "railway.json"), "utf8")) as RailwayConfig;

  it("builds the runtime image, so a service needs no per-service config file to build", () => {
    expect(root().build.builder).toBe("DOCKERFILE");
    expect(root().build.dockerfilePath).toBe("infrastructure/docker/runtime.Dockerfile");
  });

  it("pins NO start command, so each service decides what it runs", () => {
    // The load-bearing assertion. Railway: "Configuration defined in code will always override
    // values from the dashboard" — so a `startCommand` here would silently beat the start command
    // set on a service, and EVERY service built from this repo would run the API. Not hypothetical:
    // the worker service ran `src/api.ts` and logged `api listening` until this field was removed.
    // Nor can it be fixed per-service with a config file: Railway deprecated config-as-code, and
    // "starting 2026-08-28, services that have never used Config as Code cannot opt in" — which is
    // every service created from then on, including that worker.
    expect(root().deploy.startCommand).toBeUndefined();
  });

  it("leaves the API as the image default, so a service with no start command still serves HTTP", () => {
    // With no startCommand anywhere, Railway runs the image CMD. That CMD must stay the API: the
    // API service sets no start command of its own and relies on exactly this.
    const dockerfile = readFileSync(join(ROOT, "infrastructure/docker/runtime.Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^CMD \["node", "--import", "tsx", "src\/api\.ts"\]$/m);
  });

  it("keeps the worker command OUT of the image default, so running the worker is a deliberate act", () => {
    const dockerfile = readFileSync(join(ROOT, "infrastructure/docker/runtime.Dockerfile"), "utf8");
    expect(dockerfile).not.toContain("src/worker.ts");
    // The command an operator sets on the worker service, kept named in one place.
    expect(railway("worker.railway.json").deploy.startCommand).toBe(
      "node --import tsx src/worker.ts",
    );
  });
});
