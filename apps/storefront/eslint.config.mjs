import next from "@platform/eslint-config/next";

export default [
  { ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"] },
  ...next,
  {
    // The hero needs a raw <img>: art direction (a mobile <source> inside <picture>) is not
    // possible with <Image />, and the props come from next/image's getImageProps.
    files: ["src/components/sections/hero.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
];
