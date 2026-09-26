#!/usr/bin/env node
// WP-10 definition of done: every Prisma read/update/delete on a tenant-owned model names the tenant in
// its `where`. Prints each non-conforming call as `path:line: model.method` and exits 1 if any exist.
//
// WHY THIS EXISTS. Postgres RLS protects nothing on the application's path today (ADR-0014 point 6: the
// connection role has BYPASSRLS, and nothing sets `app.tenant_id`), so `where: { tenantId }` in each
// repository is the ONLY thing between tenants. A mutation pass over WP-10 (2026-09-26) removed that
// filter from orders, catalog and inventory repositories one at a time and NOTHING went red: their Prisma
// branches have no test that runs without a database (`*.integration.test.ts` needs DATABASE_URL_TEST).
// Finance accounts and security principals are the only Prisma repositories with a fake-backed
// isolation test. This script is the uniform, database-free guard for the rest.
//
// WHAT IT CATCHES: a `findMany | findFirst | findUnique | update | updateMany | delete | deleteMany |
// count | aggregate | groupBy | upsert` on a model whose `where` (top-level key of the call's argument
// object) does not mention `tenantId` / `tenantRef`, or has no `where` at all, or passes a `where`
// built elsewhere (a shorthand `where`, a variable) that this script cannot read.
// WHAT IT DOES NOT CATCH: a `where` that mentions `tenantId` but binds it to the WRONG value; a query
// through a raw `$queryRaw`; a `create` whose `data` omits the tenant (that is a NOT NULL column error at
// the database, and `assertWriteTimeTenant` covers the event side); a repository that never queries.
//
// EXEMPTIONS are keyed `path|model.method`, never by line number, and each carries a class and a reason.
// `open` entries are KNOWN GAPS: they are listed so they cannot be forgotten, they are not "fine".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const READ_WRITE = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
  "upsert",
]);
const ARGLESS_OK_TO_FLAG = new Set(["findMany", "count", "aggregate", "groupBy"]);

/** @typedef {{ cls: "platform-global" | "typed-where" | "open", reason: string }} Exemption */
/** @type {Record<string, Exemption>} */
export const EXEMPTIONS = {
  // Cross-tenant by design: one relay/prune/inbox process serves every tenant (WP-10 T10.7, class G).
  "packages/db/src/messaging/prisma-outbox-store.ts|outboxEntry.findMany": {
    cls: "platform-global",
    reason: "the outbox relay drains every tenant's pending rows in one pass (ADR-0014 point 4)",
  },
  "packages/db/src/messaging/prisma-outbox-store.ts|outboxEntry.updateMany": {
    cls: "platform-global",
    reason: "marks relayed rows by id; the relay is cross-tenant by design",
  },
  "packages/db/src/messaging/prisma-processed-event-store.ts|processedEvent.findUnique": {
    cls: "platform-global",
    reason: "consumer idempotency on a globally unique message id (T10.7: residual risk recorded)",
  },
  // Plans are the PLATFORM's catalogue (WP-14): owned by the platform tenant, read by every merchant.
  "services/licensing/src/infrastructure/prisma-repositories.ts|plan.updateMany": {
    cls: "platform-global",
    reason:
      "Plan is platform-owned; writes are gated to the platform tenant (licensing-platform-only.e2e)",
  },
  "services/licensing/src/infrastructure/prisma-repositories.ts|plan.findFirst": {
    cls: "platform-global",
    reason: "Plan is platform-owned catalogue data readable by every merchant",
  },
  // `where` is built by the caller and TYPED to carry the tenant: `{ readonly tenantId: string } & ...`.
  "services/fulfillment/src/infrastructure/prisma-fulfillment-order-repository.ts|fulfillmentOrder.findFirst":
    {
      cls: "typed-where",
      reason: "findOne(where: { tenantId } & ...) — the parameter type requires the tenant",
    },
  "services/returns/src/infrastructure/prisma-return-request-repository.ts|returnRequest.findFirst":
    {
      cls: "typed-where",
      reason: "findOne(where: { tenantId } & ...) — the parameter type requires the tenant",
    },
  "services/payments/src/infrastructure/prisma-payment-intent-repository.ts|paymentIntent.findFirst":
    {
      cls: "typed-where",
      reason: "findOne(where: { tenantId } & ...) — the parameter type requires the tenant",
    },
  // Cross-tenant sweeps of the shared outbox table by the scheduler (T10.7, class G): "prune once CDC has
  // flushed past a row" is one operation over one table, not a per-tenant one.
  "apps/runtime/src/scheduler.ts|outboxEntry.deleteMany": {
    cls: "platform-global",
    reason: "outbox-prune job: one shared table, run once per tick for the platform (T10.7)",
  },
  "apps/runtime/src/scheduler.ts|outboxEntry.count": {
    cls: "platform-global",
    reason: "outbox-prune job: counts the shared table's backlog (T10.7)",
  },
  // Not a Prisma call: a repository PORT named `store` whose upsert takes its tenant as a separate argument.
  "services/security/src/interfaces/consent-changed.consumer.ts|store.upsert": {
    cls: "typed-where",
    reason:
      "ConsentProjectionStore port, not Prisma; the tenant is an explicit argument (readEnvelopeTenant)",
  },
  // KNOWN GAPS. Each is a row addressed by id alone.
  "apps/runtime/src/tracking/prisma-event-record-store.ts|trackingEventRecord.findFirst": {
    cls: "open",
    reason:
      "G-75: appendHistory/get find the base row by eventId ALONE, but the key is (tenantId, eventId) and " +
      "the collector accepts a client-supplied eventId — two tenants can share one, and history lands on whichever row is found first",
  },
  "services/catalog/src/infrastructure/prisma-catalog-repositories.ts|productVariant.upsert": {
    cls: "open",
    reason:
      "G-76: upsert by id alone would move another tenant's variant if a variant id collided; reachable only " +
      "with a client-chosen id, which no route accepts today (ids come from the tenant-scoped aggregate)",
  },
  "services/payments/src/infrastructure/prisma-payment-intent-repository.ts|refund.upsert": {
    cls: "open",
    reason:
      "G-76: upsert by id alone; refund ids are server-generated on the tenant-scoped aggregate, so not reachable today",
  },
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage" || name === "testing")
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !/\.(test|spec|integration\.test)\.ts$/.test(p)) out.push(p);
  }
  return out;
}

/** Index just past the bracket that closes the one opening at `open` (strings/comments skipped). */
function closeOf(text, open) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i === -1) return text.length;
      i += 1;
      continue;
    }
    if (pairs[c] !== undefined) depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** The text of the top-level `where` value in an argument object literal, or `undefined` / `null`. */
function whereOf(argObject) {
  // argObject starts with `{`. Walk its top-level keys.
  let depth = 0;
  for (let i = 0; i < argObject.length; i++) {
    const c = argObject[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < argObject.length && argObject[i] !== c; i++) if (argObject[i] === "\\") i++;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      depth++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      continue;
    }
    if (depth === 1 && /[A-Za-z_]/.test(c) && !/[\w$]/.test(argObject[i - 1] ?? " ")) {
      const m = /^where\b\s*(:|,|\})/.exec(argObject.slice(i));
      if (m !== null) {
        if (m[1] !== ":") return null; // shorthand `where` — a value built elsewhere
        let j = i + m[0].length;
        while (/\s/.test(argObject[j])) j++;
        if (argObject[j] === "{") return argObject.slice(j, closeOf(argObject, j));
        let k = j;
        while (k < argObject.length && !(argObject[k] === "," && depth === 1)) k++;
        return argObject.slice(j, k).trim() === "" ? null : `\u0000${argObject.slice(j, k)}`;
      }
    }
  }
  return undefined;
}

export function scanPrismaTenantWhere(repoRoot) {
  const roots = ["services", "packages", "apps"];
  const violations = [];
  const seenExemptions = new Set();
  for (const root of roots) {
    let units;
    try {
      units = readdirSync(join(repoRoot, root));
    } catch {
      continue;
    }
    for (const unit of units) {
      const src = join(repoRoot, root, unit, "src");
      try {
        statSync(src);
      } catch {
        continue;
      }
      for (const file of walk(src)) {
        const rel = relative(repoRoot, file).split(sep).join("/");
        const text = readFileSync(file, "utf8");
        const re = /\.(\w+)\.(\w+)\(/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const [whole, model, method] = m;
          if (!READ_WRITE.has(method)) continue;
          const open = m.index + whole.length - 1;
          const argsEnd = closeOf(text, open);
          const args = text.slice(open + 1, argsEnd - 1).trim();
          const isPrismaShaped =
            args.startsWith("{") || (args === "" && ARGLESS_OK_TO_FLAG.has(method));
          if (!isPrismaShaped) continue;
          const line = text.slice(0, m.index).split("\n").length;
          const lineText = text.split("\n")[line - 1] ?? "";
          if (/^\s*(\*|\/\/)/.test(lineText)) continue; // prose mention
          let where = args === "" ? undefined : whereOf(args);
          if (where === null) {
            // Shorthand `where`: resolve it to the nearest preceding `const where = { ... }` in this file.
            const before = text.slice(0, m.index);
            const at = before.lastIndexOf("const where");
            if (at !== -1) {
              const eq = text.indexOf("=", at);
              let j = eq + 1;
              while (/\s/.test(text[j])) j++;
              if (text[j] === "{") where = text.slice(j, closeOf(text, j));
            }
          }
          const named = typeof where === "string" && /\b(tenantId|tenantRef)\b/.test(where);
          if (named) continue;
          const key = `${rel}|${model}.${method}`;
          if (EXEMPTIONS[key] !== undefined) {
            seenExemptions.add(key);
            continue;
          }
          const why =
            where === undefined
              ? "has no `where`"
              : where === null || where.startsWith("\u0000")
                ? "passes a `where` built elsewhere that this check cannot read"
                : "has a `where` that does not mention tenantId";
          violations.push(`${rel}:${line}: ${model}.${method} ${why}`);
        }
      }
    }
  }
  const stale = Object.keys(EXEMPTIONS).filter((k) => !seenExemptions.has(k));
  return {
    violations,
    stale,
    open: Object.entries(EXEMPTIONS).filter(([, v]) => v.cls === "open"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = process.argv[2] ?? process.cwd();
  const { violations, stale, open } = scanPrismaTenantWhere(repoRoot);
  for (const v of violations) process.stdout.write(`${v}\n`);
  for (const k of stale)
    process.stdout.write(`stale exemption (no longer matches any call): ${k}\n`);
  if (process.env.SHOW_OPEN === "1")
    for (const [k, v] of open) process.stderr.write(`open: ${k} — ${v.reason}\n`);
  process.exit(violations.length === 0 && stale.length === 0 ? 0 : 1);
}
