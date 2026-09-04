import base from "@platform/eslint-config/base";

/** Root ESLint flat config — governs packages/ and tooling/. Apps own their own config. */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      // k6/chaos scripts run in non-Node ambient-global environments (k6's __ENV, shell) and are
      // outside the turbo-scoped lint workspaces by design (P2 Batch G / H-5).
      "perf/**",
      "chaos/**",
      // Ory Permission Language file: valid syntax for Ory's own OPL compiler (uploaded via
      // `ory patch opl` or the Ory Console), not part of this repo's TypeScript build or any
      // tsconfig — no project-service config covers it, by design.
      "infrastructure/ory/network/**",
    ],
  },
  ...base,
];
