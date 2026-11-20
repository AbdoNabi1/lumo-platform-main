# Brand lock — Nusuj (نسيج) — Warm Weave

**Owner decision, 2026-11-19:** Morbeh's brand is "Nusuj — Warm Weave". It is locked. Nobody,
human or model, changes the colours, fonts, radii, logo, favicon or button shape without an
**explicit order from the owner**. Agents must refuse or ask. Full token reference:
[MORBEH_DESIGN_SYSTEM.md](./MORBEH_DESIGN_SYSTEM.md).

## What is locked

| Item                                       | Value                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary` 50–950                           | `#fdf3ee` `#fae4d8` `#f5c9b4` `#f5916e` `#ef7b52` **`#b8451d`** `#9a3714` `#7e2d10` `#64240d` `#4c1c0b` `#3a1c10`                                                                                 |
| `neutral` 0–950 (warm sand)                | `#ffffff` `#fcf8f3` `#f3e9de` `#e8ded3` `#d5c8ba` `#a1968b` `#8a7f75` `#5d636a` `#3f3a36` `#2b2724` `#212529` `#141210`                                                                           |
| `night` 50/300/400/500/700/800/850/900/950 | `#faf6f2` `#d3c9bf` `#b5aca3` `#8c8279` `#3f3832` `#342e29` `#29231e` `#1e1b18` `#141210`                                                                                                         |
| `brand` light / dark                       | secondary `#4c362e` / `#dec8b4`; icon accent `#f9d5c6` / `#f9d5c6`; on-primary ink `#1a1512`                                                                                                      |
| Status light (primary/soft/strong)         | success `#1f8a57`/`#ebf7f0`/`#1a6e47` · warning `#c77a0a`/`#fef4e5`/`#8e5005` · error `#c0263a`/`#fcebec`/`#9b1c2e` · info `#3a6ea5`/`#edf4fa`/`#2f5882`                                          |
| Status dark (primary/soft/strong)          | success `#2fa36b`/`#142b20`/`#5bd998` · warning `#d9901c`/`#2c2111`/`#f3b753` · error `#e5484d`/`#3a1518`/`#ff8a8f` · info `#4a86c5`/`#162331`/`#83b5e8`                                          |
| Semantic map                               | all 45 keys × light and dark: MORBEH_DESIGN_SYSTEM.md §4.4 (mirrors `semantic.ts` and `styles.css`)                                                                                               |
| Fonts                                      | Latin UI **Plus Jakarta Sans** · Arabic UI **Zain** · display (h1, wordmark) **Baloo Bhaijaan 2**. Zain has no 500/600: they render 400/700. Never fake weights.                                  |
| Radius                                     | xs 4 · sm 6 · md 8 · lg 12 · xl 16 · **2xl 22** · 3xl 28 · full 9999 px. Buttons are pills (`rounded-button` = 9999px in the dashboard); storefront buttons follow the merchant's corner setting. |
| Logo (`BrandMark`)                         | viewBox `0 0 64 64`: circle (17,19) r9 `brand-secondary` · rect (30,10) 26×18 rx9 `primary` · rect (8,36) 26×18 rx9 `primary` · circle (47,45) r9 `brand-secondary`                               |
| Favicon (`icon.svg`)                       | rounded square rx 14, fill `#b8451d`; bento in `translate(6 6) scale(.81)`; pills `#ffffff`; circles `#f9d5c6`                                                                                    |

Storefront boundary, both sides. **Locked:** the default storefront palette, used by shops
with no saved colours, is the Nusuj palette (the storefront imports the design stylesheet).
**Not touched:** merchant-chosen fonts (the storefront binds Geist / IBM Plex Sans Arabic) and
saved merchant theme documents, which are never rewritten.

## What enforces it

- `packages/design/src/brand-lock.test.ts` — every primitive, all 45 semantic values in both themes, radii, font stacks, and CSS↔TS parity.
- `packages/design/src/contrast.test.ts` — the WCAG AA pairs.
- `apps/admin-web/src/components/brand-mark.test.tsx` — logo geometry and token classes.
- `apps/admin-web/src/app/icon.test.ts` — favicon geometry and fills.
- `apps/admin-web/src/app/brand-fonts.test.ts` — font slots, h1 display rule, font imports.
- `packages/ui/src/components/ui/primitives.test.tsx` — buttons use `rounded-button`, never `rounded-full`.
- `apps/storefront/src/app/button-corners.test.ts` — the storefront maps `--radius-button` to the merchant's corner scale (square 0px, rounded 16px, pill 24px).
- `.github/CODEOWNERS` — requests `@AbdoNabi1` as reviewer for the locked files.
- `AGENTS.md` — tells agents to refuse or ask.

**Honest limit (as of 2026-11-19).** `main` of `AbdoNabi1/lumo-platform-main` has no branch
protection and no rulesets. So CODEOWNERS only _requests_ the owner's review; it does not
block a merge. The CI job "Lint, typecheck, build, test" runs the lock tests, but it is not a
required check. Today the lock is a documented, tested lock, not an owner-only merge gate.

To make it a real gate, the owner does this in GitHub: Settings → Branches → add a rule for
`main` → enable "Require a pull request before merging" with **"Require review from Code
Owners"**, and enable **"Require status checks to pass before merging"**, adding the check
"Lint, typecheck, build, test".

## Changing the brand

1. The owner gives an explicit order (a request to "improve" or "modernise" is not one).
2. In one commit: update the tables here, MORBEH_DESIGN_SYSTEM.md §3–§6, the tokens
   (`primitives.ts`, `semantic.ts`, `styles.css`) and every lock test above.
3. The owner reviews and merges. Never weaken a lock test to make a change pass.
