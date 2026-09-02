import { describe, expect, it } from "vitest";
import type { Logger } from "@platform/utils";
import { KetoRelationshipClient } from "./keto-relationships";

/**
 * LIVE Ory Keto integration suite (H-2, G-SEC-4). Requires a running Keto with read + write APIs:
 *
 *   KETO_READ_URL_TEST=http://localhost:4466 KETO_WRITE_URL_TEST=http://localhost:4467 \
 *     pnpm --filter @platform/auth test
 *
 * HONESTLY GATED: skipped unless BOTH URLs are set — never faked. CI's `ory-integration` job provisions
 * Keto (docker) before running it. Exercises the real write → check → delete round-trip against Keto.
 */
const readUrl = process.env["KETO_READ_URL_TEST"];
const writeUrl = process.env["KETO_WRITE_URL_TEST"];

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

describe.runIf(Boolean(readUrl) && Boolean(writeUrl))(
  "KetoRelationshipClient (live Keto integration)",
  () => {
    const client = new KetoRelationshipClient({
      readUrl: readUrl ?? "",
      writeUrl: writeUrl ?? "",
      fetch: async (url, init) => fetch(url, init),
      namespace: "permissions",
      logger: silent,
    });

    it("writes a tuple, sees the check pass, deletes it, and sees the check fail", async () => {
      const tuple = {
        namespace: "permissions",
        object: `doc:${crypto.randomUUID()}`,
        relation: "viewer",
        subject: `principal:${crypto.randomUUID()}`,
      };
      const query = {
        namespace: tuple.namespace,
        object: tuple.object,
        relation: tuple.relation,
        subjectId: tuple.subject,
      };

      await client.write(tuple);
      expect(await client.check(query)).toBe(true);

      await client.delete(tuple);
      expect(await client.check(query)).toBe(false);

      // Delete is idempotent (already gone).
      await expect(client.delete(tuple)).resolves.toBeUndefined();
    });
  },
);
