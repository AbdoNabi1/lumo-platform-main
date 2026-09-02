#!/usr/bin/env node
/**
 * Local (non-Docker) composition for `pnpm dev`: runs api + worker + scheduler concurrently as
 * child processes, each in `tsx watch` mode. All three share one `PORT` config field
 * (`src/config.ts`) — the api's Fastify server and the worker/scheduler's `startHealthServer`
 * (`src/modules/health-server.module.ts`) all bind it — so on one host (no per-container network
 * isolation the way `docker-compose.runtime.yml` gets it) they need distinct values or they
 * collide. This gives each child its own PORT, mirroring that same overlay's 3080/3081/3082
 * host-port convention, without touching the shared config schema. Zero new dependency — matches
 * the repo's existing zero-dep script convention (`scripts/dev/mint-local-token.mjs`,
 * `scripts/governance/run.mjs`).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const runtimeDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  { name: "api", entry: "src/api.ts", port: process.env.PORT ?? "3080" },
  { name: "worker", entry: "src/worker.ts", port: process.env.RUNTIME_WORKER_PORT ?? "3081" },
  {
    name: "scheduler",
    entry: "src/scheduler.ts",
    port: process.env.RUNTIME_SCHEDULER_PORT ?? "3082",
  },
];

const children = targets.map(({ name, entry, port }) => {
  const child = spawn("tsx", ["watch", entry], {
    cwd: runtimeDir,
    env: { ...process.env, PORT: port },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code !== 0) {
      console.error(`[dev-all] "${name}" exited with code ${code}`);
    }
  });
  return child;
});

let shuttingDown = false;
/** @param {NodeJS.Signals} signal */
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
