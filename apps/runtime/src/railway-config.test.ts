import { existsSync, readdirSync, readFileSync } from "node:fs";
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
/**
 * There is NO root `railway.json`, on purpose. Railway: "Configuration defined in code will always
 * override values from the dashboard" — so a root config file decides the Dockerfile, the start
 * command and the health check for EVERY service built from this repo, and no per-service setting
 * can override it. Two things that cost a day are why it went:
 *
 * - it carried the API's start command, so the worker service ran `src/api.ts`;
 * - it carried the runtime Dockerfile, so the storefront — which needs `web.Dockerfile` — could
 *   not have been built from this repo at all.
 *
 * Per-service config files cannot replace it: Railway deprecated config-as-code ("Existing config
 * files keep working until 2026-12-01") and "starting 2026-08-28, services that have never used
 * Config as Code cannot opt in". So each service picks its image with the `RAILWAY_DOCKERFILE_PATH`
 * variable and its process with its start command (or the image default), both set on the service.
 */
describe("no root railway.json — every service configures itself", () => {
  it("has no root railway.json or railway.toml to override the services' own settings", () => {
    expect(existsSync(join(ROOT, "railway.json"))).toBe(false);
    expect(existsSync(join(ROOT, "railway.toml"))).toBe(false);
  });

  it("keeps the API as the runtime image default, so the API service needs no start command", () => {
    // With no start command set, Railway runs the image CMD. The API service sets none and relies
    // on exactly this.
    const dockerfile = readFileSync(join(ROOT, "infrastructure/docker/runtime.Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^CMD \["node", "--import", "tsx", "src\/api\.ts"\]$/m);
  });

  it("keeps the worker command OUT of the image default, so running the worker is a deliberate act", () => {
    const dockerfile = readFileSync(join(ROOT, "infrastructure/docker/runtime.Dockerfile"), "utf8");
    expect(dockerfile).not.toContain("src/worker.ts");
    expect(railway("worker.railway.json").deploy.startCommand).toBe(
      "node --import tsx src/worker.ts",
    );
  });

  it("uses no BuildKit cache mount, which Railway's builder rejects without a per-service id", () => {
    // "flag '--mount=type=cache,id=pnpm,target=/pnpm/store' is missing the cacheKey prefix from its
    // id" failed the storefront's first build. The prefix Railway wants is the service's own id, so
    // a cache mount cannot be written portably at all.
    const dir = join(ROOT, "infrastructure/docker");
    const dockerfiles = readdirSync(dir).filter((name) => name.endsWith(".Dockerfile"));
    // Guards the loop below against passing vacuously over an empty or misread directory.
    expect(dockerfiles).toEqual(expect.arrayContaining(["runtime.Dockerfile", "web.Dockerfile"]));
    for (const file of dockerfiles) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/^RUN\s+--mount=type=cache/m);
    }
  });

  it("gives the storefront its own image whose default is the storefront server", () => {
    // The storefront service sets RAILWAY_DOCKERFILE_PATH to this file and no start command.
    const dockerfile = readFileSync(join(ROOT, "infrastructure/docker/web.Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^CMD \["node", "apps\/storefront\/server\.js"\]$/m);
    expect(railway("storefront.railway.json").build.dockerfilePath).toBe(
      "infrastructure/docker/web.Dockerfile",
    );
  });
});
