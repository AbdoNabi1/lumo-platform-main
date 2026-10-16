import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-registers cleanup when Vitest globals are on; this suite runs
// with `globals: false`, so unmount between tests explicitly.
afterEach(cleanup);

// `findBy*` and `waitFor` give up after 1s by default. On a loaded CI runner the editor suites
// run several times slower than locally (the product editor file takes ~30s there), and a
// server-action state update or a Radix dialog unmount can land after that second.
configure({ asyncUtilTimeout: 4000 });
