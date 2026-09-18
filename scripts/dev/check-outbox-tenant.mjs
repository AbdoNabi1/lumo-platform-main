#!/usr/bin/env node
// ADR-0014 amendment (2026-09-18): every outbox write in a CONVERTED context must merge the
// per-call tenantId into the event context — `{ ...this.deps.context, tenantId }`.
// Prints each non-conforming `outbox.write(...)` call as `path:line` and exits 1 if any exist.
//
// "Converted" is derived, not listed: a context is unconverted while its composition still builds
// `rootEventContext(deps.idGenerator, tenantId)` (construction-time tenant); everything else is
// converted, so contexts join the check automatically as they convert.
//
// Catches: a write call whose argument list never mentions `tenantId` (forgot the merge).
// Does NOT catch: a merge of the wrong tenant, a write via a helper that hides the call, or a
// context that never writes to the outbox. `services/example` is the generator template and is
// exempt (it has no tenant; its write site carries a comment saying so).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "services";
const EXEMPT = new Set(["example"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function isUnconverted(files) {
  return files.some(
    (f) =>
      /composition\.ts$/.test(f) &&
      /rootEventContext\(\s*deps\.idGenerator\s*,\s*\w+/.test(readFileSync(f, "utf8")),
  );
}

let bad = 0;
for (const svc of readdirSync(root)) {
  const src = join(root, svc, "src");
  try {
    statSync(src);
  } catch {
    continue;
  }
  if (EXEMPT.has(svc)) continue;
  const files = walk(src);
  if (isUnconverted(files)) continue;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const re = /outbox\.write\(/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split("\n").length;
      if (/^\s*(\*|\/\/)/.test(text.split("\n")[line - 1])) continue; // prose mention
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < text.length && depth > 0) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        i++;
      }
      if (!/\btenantId\b/.test(text.slice(m.index, i))) {
        console.log(`${f}:${line}: outbox.write without a merged tenantId`);
        bad++;
      }
    }
  }
}
process.exit(bad === 0 ? 0 : 1);
