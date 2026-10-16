/**
 * `@platform/ui` — the Morbeh Design System component library.
 *
 * These primitives are the only sanctioned way to build a Morbeh surface. They consume
 * semantic tokens from `@platform/design` exclusively; none of them contains a hex value,
 * a raw pixel colour, or a second opinion about the design language.
 *
 * Docs: docs/ui/MORBEH_DESIGN_SYSTEM.md
 */

export * from "./lib/cn";
export * from "./lib/focus";
export * from "./providers/theme-provider";
export * from "./components/theme-toggle";

export * from "./components/ui/avatar";
export * from "./components/ui/badge";
export * from "./components/ui/button";
export * from "./components/ui/card";
export * from "./components/ui/command-search";
export * from "./components/ui/dialog";
export * from "./components/ui/dropdown-menu";
export * from "./components/ui/input";
export * from "./components/ui/label";
export * from "./components/ui/separator";
export * from "./components/ui/skeleton";
export * from "./components/ui/table";
export * from "./components/ui/tabs";
export * from "./components/ui/tooltip";
