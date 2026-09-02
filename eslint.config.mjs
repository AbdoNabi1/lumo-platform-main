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
    ],
  },
  ...base,
];
