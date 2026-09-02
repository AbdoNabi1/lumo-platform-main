# @platform/clock

Infrastructure adapter providing `SystemClock`, which implements the application `Clock` port
(declared in `@platform/contracts`). Mirrors `@platform/id` exactly: a small adapter at the
impure boundary, wired to the `CLOCK` DI token (in `@platform/application`) at the composition
root. The domain never reads the clock; other code injects a fixed clock for deterministic tests.

See `docs/DECISIONS.md` (D-019).
