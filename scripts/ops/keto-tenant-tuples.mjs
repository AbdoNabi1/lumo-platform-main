// G-70 — shared core of the three Keto tenant-migration operator scripts:
//   scripts/ops/ory-keto-backfill.mjs      (a qualified twin for every bare tuple)
//   scripts/ops/ory-keto-count-gate.mjs    (bare vs qualified, must match exactly — the interlock)
//   scripts/ops/ory-keto-delete-bare.mjs   (refuses unless the gate passes)
// Runbook: docs/operations/KETO_TENANT_MIGRATION.md.
//
// Everything here takes an injected client and output function, so the unit tests run it against a
// fake Keto (packages/auth/src/keto-tenant-migration-scripts.test.ts) and never touch Ory.
//
// The tuple model (docs/architecture/23-platform-gap-register.md, G-70): a grant is
// `(permissions, <object>, granted, <subject>)`. Bare object = `<permission>`; qualified object =
// `tenant/<tenantId>/<permission>`. The subject is untouched. A tuple is compared by
// (relation, permission, subject); the subject is a direct `subject_id` or an Ory Network
// `subject_set` (`namespace:object#relation`).

export const NAMESPACE = "permissions";
const PREFIX = "tenant/";
const PAGE_SIZE = 500;

// Ory Network answered 2xx for EVERY write of a burst and persisted only a prefix of it (first live
// run, 2026-09-21: 65 PUTs "succeeded", 19 landed; a re-run of the 46 left, 11 landed — each time the
// first N in order). A 2xx is therefore not proof of a write. Every write and delete is re-read until
// it is observed, retried with backoff, and paced; a write that never lands STOPS the run (exit 2).
const PACING_MS = 300;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Perform `action` until `observed()` is true, re-issuing it with backoff. Both PUT and DELETE are
 * idempotent in Keto, so re-issuing is safe. Throws when the effect is never observed.
 */
async function untilObserved({ action, observed, label, sleep, out }) {
  await action();
  if (await observed()) return;
  for (const delay of RETRY_DELAYS_MS) {
    out(`    not observed yet, retrying in ${delay} ms: ${label}`);
    await sleep(delay);
    await action();
    if (await observed()) return;
  }
  throw new Error(
    `Ory accepted the request but its effect was never observed after ${RETRY_DELAYS_MS.length + 1} attempts: ${label}. ` +
      "The run stopped here; everything before it is verified. Re-run the same command to continue.",
  );
}

/** The qualified object. Same string as `objectFor` in packages/auth/src/keto.ts (a test pins them). */
export function qualify(tenantId, permission) {
  assertTenantId(tenantId);
  return `${PREFIX}${tenantId}/${permission}`;
}

export function assertTenantId(tenantId) {
  if (typeof tenantId !== "string" || tenantId === "" || tenantId.includes("/")) {
    throw new Error(`invalid tenant id ${JSON.stringify(tenantId)} (non-empty, no "/")`);
  }
}

/** `{ tenantId: null, permission }` for a bare object; the tenant is the segment up to the first `/`. */
export function parseObject(object) {
  if (!object.startsWith(PREFIX)) return { tenantId: null, permission: object };
  const rest = object.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return { tenantId: null, permission: object }; // malformed: treat as bare, never as a twin
  return { tenantId: rest.slice(0, slash), permission: rest.slice(slash + 1) };
}

/** Stable subject identity: a direct id, or `namespace:object#relation` for a subject set. */
export function subjectOf(tuple) {
  if (typeof tuple.subject_id === "string" && tuple.subject_id !== "") return tuple.subject_id;
  const set = tuple.subject_set;
  if (set) return `${set.namespace}:${set.object}#${set.relation}`;
  return "";
}

/** The write body for a tuple, preserving its subject shape, with a replaced object. */
function bodyOf(tuple, object) {
  const base = { namespace: tuple.namespace, object, relation: tuple.relation };
  return tuple.subject_set
    ? { ...base, subject_set: tuple.subject_set }
    : { ...base, subject_id: tuple.subject_id };
}

function deleteParams(tuple) {
  const params = new URLSearchParams({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
  });
  if (tuple.subject_set) {
    params.set("subject_set.namespace", tuple.subject_set.namespace);
    params.set("subject_set.object", tuple.subject_set.object);
    params.set("subject_set.relation", tuple.subject_set.relation);
  } else {
    params.set("subject_id", tuple.subject_id);
  }
  return params;
}

/**
 * A thin Keto REST client over an injected `fetch`. Ory Network serves the read and the write API on
 * the one project URL. Every non-success THROWS — a script that cannot read the truth must not guess.
 */
export function createKetoClient({ baseUrl, apiKey, fetch }) {
  const root = baseUrl.replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
  const fail = async (what, res) => {
    const body = typeof res.text === "function" ? await res.text() : "";
    throw new Error(`${what} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  };
  return {
    /** Every tuple in the namespace, following `next_page_token` to the end. */
    async list(namespace = NAMESPACE) {
      const all = [];
      let token = "";
      do {
        const params = new URLSearchParams({ namespace, page_size: String(PAGE_SIZE) });
        if (token !== "") params.set("page_token", token);
        const res = await fetch(`${root}/relation-tuples?${params.toString()}`, { headers });
        if (res.status !== 200) await fail("list relation-tuples", res);
        const page = await res.json();
        all.push(...(page.relation_tuples ?? []));
        token = page.next_page_token ?? "";
      } while (token !== "");
      return all;
    },
    /** Whether this exact tuple exists (a filtered list: namespace, object, relation, subject). */
    async exists(tuple) {
      const res = await fetch(`${root}/relation-tuples?${deleteParams(tuple).toString()}`, {
        headers,
      });
      if (res.status !== 200) await fail("read back relation-tuple", res);
      const page = await res.json();
      return (page.relation_tuples ?? []).length > 0;
    },
    async put(body) {
      const res = await fetch(`${root}/admin/relation-tuples`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
      if (![200, 201, 204].includes(res.status)) await fail("put relation-tuple", res);
    },
    async remove(tuple) {
      const res = await fetch(`${root}/admin/relation-tuples?${deleteParams(tuple).toString()}`, {
        method: "DELETE",
        headers,
      });
      if (![200, 204, 404].includes(res.status)) await fail("delete relation-tuple", res);
    },
  };
}

const keyOf = (relation, permission, subject) => JSON.stringify([relation, permission, subject]);

/**
 * Splits the listing for one tenant and compares it. `bare` = objects with no `tenant/` prefix;
 * `qualified` = the twins for `tenantId`. Twins for OTHER tenants are counted but never compared —
 * they are not this migration's business and can legitimately exist once a second tenant has grants.
 */
export function computeGate(tuples, tenantId) {
  assertTenantId(tenantId);
  const bare = new Map();
  const qualified = new Map();
  let otherTenants = 0;
  for (const tuple of tuples) {
    const { tenantId: t, permission } = parseObject(tuple.object);
    const key = keyOf(tuple.relation, permission, subjectOf(tuple));
    if (t === null) bare.set(key, { tuple, permission, subject: subjectOf(tuple) });
    else if (t === tenantId) qualified.set(key, { tuple, permission, subject: subjectOf(tuple) });
    else otherTenants += 1;
  }
  const missingTwin = [...bare].filter(([k]) => !qualified.has(k)).map(([, v]) => v);
  const orphanQualified = [...qualified].filter(([k]) => !bare.has(k)).map(([, v]) => v);

  const tally = (pick) => {
    const rows = new Map();
    const bump = (name, field) => {
      const row = rows.get(name) ?? { name, bare: 0, qualified: 0 };
      row[field] += 1;
      rows.set(name, row);
    };
    for (const v of bare.values()) bump(pick(v), "bare");
    for (const v of qualified.values()) bump(pick(v), "qualified");
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const perPermission = tally((v) => v.permission);
  const perSubject = tally((v) => v.subject);

  let status;
  if (bare.size === 0 && qualified.size === 0) status = "empty";
  else if (bare.size === 0) status = "contracted";
  else status = missingTwin.length === 0 && orphanQualified.length === 0 ? "match" : "mismatch";

  return {
    tenantId,
    status,
    bare: [...bare.values()],
    qualified: [...qualified.values()],
    otherTenants,
    missingTwin,
    orphanQualified,
    perPermission,
    perSubject,
  };
}

function printGate(gate, out) {
  // After the contract step every qualified tuple has no bare twin BY DESIGN, so a bare-vs-qualified
  // comparison would flag every row. In that state a row is only wrong if it still has a bare tuple.
  const contracted = gate.status === "contracted";
  const table = (title, rows) => {
    out(`\n${title}`);
    for (const r of rows) {
      const ok = contracted ? r.bare === 0 : r.bare === r.qualified;
      const flag = ok ? "  ok" : "  MISMATCH";
      out(
        `  ${String(r.bare).padStart(4)} bare  ${String(r.qualified).padStart(4)} qualified  ${r.name}${flag}`,
      );
    }
  };
  out(`Keto tuples in namespace "${NAMESPACE}", tenant "${gate.tenantId}":`);
  out(
    `  bare: ${gate.bare.length}   qualified(${gate.tenantId}): ${gate.qualified.length}   other-tenant twins (ignored): ${gate.otherTenants}`,
  );
  table("per permission:", gate.perPermission);
  table("per subject:", gate.perSubject);
  for (const m of gate.missingTwin) {
    out(
      `MISSING TWIN  ${m.tuple.object}  ${m.tuple.relation}  ${m.subject}  (a bare tuple with no qualified twin)`,
    );
  }
  for (const o of contracted ? [] : gate.orphanQualified) {
    out(
      `ORPHAN TWIN   ${o.tuple.object}  ${o.tuple.relation}  ${o.subject}  (a qualified tuple with no bare tuple)`,
    );
  }
}

const gateVerdict = {
  match: ["PASS: bare and qualified match exactly.", 0],
  contracted: [
    "PASS (nothing at risk): no bare tuples remain — the contract step has already run.",
    0,
  ],
  empty: ["FAIL: no tuples at all in this namespace — wrong project or wrong credentials?", 1],
  mismatch: ["FAIL: bare and qualified do NOT match. Do not delete the bare tuples.", 1],
};

/** The count gate: read-only. Exit 0 only on an exact match (or an already-contracted state). */
export async function runCountGate({ client, tenantId, out }) {
  const gate = computeGate(await client.list(), tenantId);
  printGate(gate, out);
  const [message, code] = gateVerdict[gate.status];
  out(`\n${message}`);
  return code;
}

/** Backfill: a qualified twin for every bare tuple that lacks one. Idempotent (PUT is an upsert). */
export async function runBackfill({ client, tenantId, apply, out, sleep = realSleep }) {
  const gate = computeGate(await client.list(), tenantId);
  out(
    `Backfill tenant "${tenantId}": ${gate.bare.length} bare tuple(s), ${gate.missingTwin.length} need a twin.`,
  );
  for (const m of gate.missingTwin) {
    out(
      `  ${apply ? "PUT" : "would PUT"}  ${qualify(tenantId, m.permission)}  ${m.tuple.relation}  ${m.subject}`,
    );
  }
  if (!apply) {
    out("\nDRY RUN — nothing written. Re-run with --apply to write these tuples.");
    return 0;
  }
  out("");
  for (const [i, m] of gate.missingTwin.entries()) {
    const body = bodyOf(m.tuple, qualify(tenantId, m.permission));
    const label = `${body.object}  ${body.relation}  ${m.subject}`;
    await untilObserved({
      action: () => client.put(body),
      observed: () => client.exists(body),
      label,
      sleep,
      out,
    });
    out(`  verified ${i + 1}/${gate.missingTwin.length}  ${label}`);
    await sleep(PACING_MS);
  }
  out(
    `\nWrote and read back ${gate.missingTwin.length} qualified tuple(s). Now run the count gate.`,
  );
  return 0;
}

/** Delete the bare tuples — but ONLY after the gate, evaluated here on a fresh listing, passes. */
export async function runDeleteBare({ client, tenantId, apply, out, sleep = realSleep }) {
  const gate = computeGate(await client.list(), tenantId);
  printGate(gate, out);
  if (gate.status === "contracted") {
    out("\nNothing to delete: no bare tuples remain.");
    return 0;
  }
  if (gate.status !== "match") {
    out(`\nREFUSING to delete bare tuples: the count gate did not pass (${gate.status}).`);
    out("Run the backfill and the count gate first; nothing was deleted.");
    return 1;
  }
  for (const b of gate.bare) {
    out(
      `  ${apply ? "DELETE" : "would DELETE"}  ${b.tuple.object}  ${b.tuple.relation}  ${b.subject}`,
    );
  }
  if (!apply) {
    out(
      `\nDRY RUN — nothing deleted. The gate passed; ${gate.bare.length} bare tuple(s) would go. Re-run with --apply.`,
    );
    return 0;
  }
  for (const [i, b] of gate.bare.entries()) {
    const label = `${b.tuple.object}  ${b.tuple.relation}  ${b.subject}`;
    await untilObserved({
      action: () => client.remove(b.tuple),
      observed: async () => !(await client.exists(b.tuple)),
      label,
      sleep,
      out,
    });
    out(`  deleted and verified ${i + 1}/${gate.bare.length}  ${label}`);
    await sleep(PACING_MS);
  }
  out(`\nDeleted and verified ${gate.bare.length} bare tuple(s).`);
  return 0;
}

/** `--tenant <id>` (required, no default) and `--apply`. Unknown flags are an error, not ignored. */
export function parseArgs(argv) {
  let tenantId;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--tenant") {
      tenantId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--tenant=")) tenantId = arg.slice("--tenant=".length);
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (tenantId === undefined) {
    throw new Error("--tenant <tenantId> is required (there is deliberately no default)");
  }
  assertTenantId(tenantId);
  return { tenantId, apply };
}

/**
 * The process entry shared by the three scripts. Exit codes: 0 ok / dry-run, 1 gate failed or
 * refused, 2 usage or an Ory/transport error.
 */
export async function cliMain(
  run,
  {
    argv = process.argv.slice(2),
    env = process.env,
    fetch: f = fetch,
    out = (line) => process.stdout.write(line + "\n"),
  } = {},
) {
  try {
    const { tenantId, apply } = parseArgs(argv);
    const baseUrl = env.ORY_SDK_URL;
    const apiKey = env.ORY_API_KEY;
    if (!baseUrl || !apiKey) throw new Error("ORY_SDK_URL and ORY_API_KEY are required");
    const client = createKetoClient({ baseUrl, apiKey, fetch: f });
    return await run({ client, tenantId, apply, out });
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    return 2;
  }
}
