import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-registers cleanup when Vitest globals are on; this suite runs
// with `globals: false`, so unmount between tests explicitly.
afterEach(cleanup);
