import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "@platform/utils";
import { renderManifest } from "./topic-inventory";

/**
 * Regenerates `infrastructure/docker/redpanda/topics.manifest`, which the compose stack's
 * `bootstrap-topics.sh` reads. `topic-inventory.test.ts` fails when the committed manifest drifts.
 *
 *     pnpm --filter @platform/runtime run topics:manifest
 */
export const MANIFEST_PATH = fileURLToPath(
  new URL("../../../../infrastructure/docker/redpanda/topics.manifest", import.meta.url),
);

if (
  process.argv[1]?.endsWith("write-manifest.ts") ||
  process.argv[1]?.endsWith("write-manifest.js")
) {
  writeFileSync(MANIFEST_PATH, renderManifest());
  logger.info("topic manifest written", { path: MANIFEST_PATH });
}
