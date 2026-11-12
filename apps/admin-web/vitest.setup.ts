import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-registers cleanup when Vitest globals are on; this suite runs
// with `globals: false`, so unmount between tests explicitly.
afterEach(cleanup);

// `findBy*` and `waitFor` give up after 1s by default. On a loaded CI runner (the whole monorepo's
// suites at once) server-action mocks and transitions settle later than that, and a different
// test failed on each run. 5s is still far under the 20s test timeout.
configure({ asyncUtilTimeout: 5000 });
