# UI contract

**What design system does Lumo use?** The **Lumo Design System**. It is the only one.

|                             |                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------- |
| **The specification**       | [LUMO_DESIGN_SYSTEM.md](LUMO_DESIGN_SYSTEM.md) — the single written source of truth |
| **The tokens (runtime)**    | `packages/design/src/styles.css`                                                    |
| **The tokens (TypeScript)** | `packages/design/src/primitives.ts`, `packages/design/src/semantic.ts`              |
| **The components**          | `packages/ui/src/components/ui/*`                                                   |
| **The reference surface**   | `apps/admin-web` — the Lumo Dashboard                                               |

## Rules

1. Components consume **semantic tokens**. No hex values, raw colours, font stacks,
   arbitrary spacing, or one-off shadows in product code.
2. Primitive scales (`--lumo-*`) exist only to define the semantic layer. Do not reach past
   a semantic token into a scale.
3. New primitives go in `@platform/ui`. Apps compose; they do not invent.
4. Lucide is the only icon library.
5. Adding a token means adding a **light value, a dark value, and a contrast assertion**.
6. Do not create a second design system, a parallel token set, or an app-local theme.

## History

This replaced the frozen admin-prototype design system on 2026-08-08. That system — its
tokens, its five `docs/ui/` specifications, and the `apps/admin/prototype/` HTML that was
its pixel reference — has been retired and removed. See [DECISIONS.md](../DECISIONS.md)
D-011 (superseded) and D-052.
