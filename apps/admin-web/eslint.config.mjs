import next from "@platform/eslint-config/next";

export default [
  { ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"] },
  ...next,
];
