#!/usr/bin/env node
// G0-5 (launch-readiness review) fitness function — `require-await` was enabled at "warn" (Stage
// 3, H-09) rather than "error" specifically because a full monorepo-wide cleanup of every existing
// case was out of that stage's scope; `packages/eslint-config/base.mjs` documents why. That
// decision is only sound if the warning count can never quietly grow — otherwise a real new
// warning is invisible in a sea of 400+ pre-existing ones, which is the exact failure mode this
// script exists to prevent, mirroring `pnpm-workspace.yaml`'s own `ignoreGhsas` convention:
// exceptions are a checked-in number a reviewer can see change, not silently tolerated.
//
// Runs the SAME `turbo run lint` every developer already runs (not a second, different lint pass)
// so this script IS the CI lint step, not an addition after it — replaces `pnpm lint` in
// ci.yml rather than running alongside it. Live output is unchanged from a normal `pnpm lint` run;
// the only difference is the pass/fail decision at the end.
//
// Usage: node scripts/ops/check-lint-warnings.mjs

import { spawn } from "node:child_process";

// The count as of this script's introduction (2026-08-22), measured with `--force` against a
// clean cache — 78/78 packages, 0 errors. Bump this UP only alongside a commit that explains why
// (a new, deliberately-warned case, not silent growth); bump it DOWN whenever cleanup work lowers
// the real count, so the gate keeps tightening rather than settling at a stale ceiling.
const MAX_WARNINGS = 413;

const child = spawn(
  "pnpm",
  ["exec", "turbo", "run", "lint", "--continue", "--output-logs=full", "--force"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    // Needed on Windows, where `pnpm` is a .cmd/.ps1 shim rather than a directly-spawnable
    // executable — child_process.spawn only resolves those through a shell. A no-op on
    // Linux/macOS CI runners, where `pnpm` is a plain binary either way.
    shell: true,
  },
);

let combined = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  combined += chunk.toString("utf8");
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  combined += chunk.toString("utf8");
});

child.on("close", (turboExitCode) => {
  // "✖ 8 problems (0 errors, 8 warnings)" — ESLint's own stylish formatter, one line per package
  // that has any findings; a clean package prints nothing here at all.
  const summaryLines = [
    ...combined.matchAll(/✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/g),
  ];
  const totalErrors = summaryLines.reduce((sum, m) => sum + Number(m[1]) - Number(m[3]), 0);
  const totalWarnings = summaryLines.reduce((sum, m) => sum + Number(m[3]), 0);

  console.error(
    `\ncheck-lint-warnings: ${totalErrors} error(s), ${totalWarnings} warning(s) ` +
      `(cap: ${MAX_WARNINGS}).`,
  );

  if (turboExitCode !== 0 && totalErrors === 0 && totalWarnings <= MAX_WARNINGS) {
    // turbo failed for a reason other than an eslint error/warning-cap breach (e.g. a package
    // script crashed) — surface that as its own failure rather than masking it as a false "lint
    // passed" from this script's own warning-count logic below.
    console.error("check-lint-warnings: turbo run lint exited non-zero for an unrelated reason.");
    process.exitCode = turboExitCode;
    return;
  }

  if (totalErrors > 0) {
    console.error(`check-lint-warnings: FAILED — ${totalErrors} lint error(s) found.`);
    process.exitCode = 1;
    return;
  }

  if (totalWarnings > MAX_WARNINGS) {
    console.error(
      `check-lint-warnings: FAILED — ${totalWarnings} warnings exceeds the checked-in cap of ` +
        `${MAX_WARNINGS}. Either fix the new warning(s), or raise MAX_WARNINGS in this file with a ` +
        "commit message explaining why the increase is deliberate.",
    );
    process.exitCode = 1;
    return;
  }

  console.error("check-lint-warnings: passed.");
  process.exitCode = 0;
});
