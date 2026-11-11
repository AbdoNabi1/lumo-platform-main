import { deflateSync } from "node:zlib";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { loginToAdminWeb } from "./support/admin-login";

/**
 * Online Store Part 3 (spec 3.7) — the homepage section editor, end to end:
 *
 *   1. the operator adds an image banner (uploading a PNG) and a featured collection (picking the
 *      seeded one), sees both in the preview frame, and finds Publish disabled;
 *   2. the admin publishes;
 *   3. a fresh visitor sees both headings on the live homepage;
 *   4. the admin turns on the password lock;
 *   5. a fresh visitor lands on `/password`, unlocks, and sees the store;
 *   6. `/robots.txt` reads `Disallow: /` while the store is locked.
 *
 * WRITTEN, NOT RUN (Ruling 24): no environment exists for the suite where this was written, so it
 * is only type-checked and linted. It needs the stack of `playwright.config.ts` and the identities
 * of `scripts/seed-e2e-identities.mjs` (the operator and admin carry the Online Store permissions).
 *
 * The collection: apps/admin has no route that creates a collection, so the one this spec picks is
 * the runtime seed's published "Featured Toys" (`apps/runtime/src/seed.ts`). Without that seed the
 * link picker finds nothing and step 1 fails on it, by name, not later.
 *
 * It changes shared state (a published theme, a store password), so the lock is always switched
 * off again, even when a step fails.
 */
const COLLECTION_NAME = "Featured Toys";
const STORE_PASSWORD = `e2e-store-${Date.now()}`;

test.describe("online store sections", () => {
  const stamp = Date.now();
  const heroHeading = `E2E hero ${stamp}`;
  const collectionHeading = `E2E collection ${stamp}`;
  const adminURL = process.env["ADMIN_WEB_URL"] ?? "http://localhost:3100";
  const storefrontURL = process.env["STOREFRONT_URL"] ?? "http://localhost:3000";

  test("add sections, publish, lock the store, unlock it", async ({ browser }) => {
    test.setTimeout(240_000);
    let adminContext: BrowserContext | null = null;
    let adminPage: Page | null = null;
    let locked = false;

    try {
      // 1. The operator builds the page.
      const operator = await signedIn(browser, adminURL, "e2e-operator@morbeh.local");
      await test.step("the operator adds an image banner and a featured collection", async () => {
        const page = operator.page;
        const frame = page.frameLocator('iframe[title="Store preview"]');

        await page.getByRole("button", { name: "Add section" }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /Image banner/ })
          .click();
        await page.locator('input[type="file"]').setInputFiles({
          name: "banner.png",
          mimeType: "image/png",
          buffer: solidPng(400),
        });
        await expect(page.getByRole("button", { name: "Remove image" })).toBeVisible({
          timeout: 30_000,
        });
        await page.getByLabel("Heading (English)").fill(heroHeading);
        await page.getByRole("button", { name: "Back to sections" }).click();

        await page.getByRole("button", { name: "Add section" }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /Featured collection/ })
          .click();
        await page.getByRole("searchbox").fill("Featured");
        await page.getByRole("button", { name: new RegExp(COLLECTION_NAME) }).click();
        await page.getByLabel("Heading (English)").fill(collectionHeading);

        await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
        await expect(frame.getByText(heroHeading)).toBeVisible({ timeout: 30_000 });
        await expect(frame.getByText(collectionHeading)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
      });
      await operator.context.close();

      // 2. The admin publishes.
      const admin = await signedIn(browser, adminURL, "e2e-admin@morbeh.local");
      const adminPageNow = admin.page;
      adminContext = admin.context;
      adminPage = adminPageNow;
      await test.step("the admin publishes", async () => {
        await adminPageNow.getByRole("button", { name: "Publish" }).click();
        await adminPage!.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
        await expect(adminPageNow.getByRole("alert")).toContainText(/Published/i, {
          timeout: 30_000,
        });
      });

      // 3. A fresh visitor sees both headings on the live homepage.
      await test.step("a fresh context sees both headings on the live homepage", async () => {
        const visitor = await browser.newContext({ baseURL: storefrontURL });
        const page = await visitor.newPage();
        await page.goto("/");
        await expect(page.getByRole("heading", { name: heroHeading })).toBeVisible({
          timeout: 60_000,
        });
        await expect(page.getByRole("heading", { name: collectionHeading })).toBeVisible();
        await visitor.close();
      });

      // 4. The admin turns on the password lock.
      await test.step("the admin turns on the password lock", async () => {
        await setLock(adminPageNow, adminURL, true);
        locked = true;
      });

      // 5. A fresh visitor is sent to /password, unlocks, and sees the store.
      await test.step("a fresh context lands on /password, unlocks, and sees the store", async () => {
        const visitor = await browser.newContext({ baseURL: storefrontURL });
        const page = await visitor.newPage();
        await page.goto("/");
        await expect(page).toHaveURL(/\/password/, { timeout: 60_000 });
        await page.locator("#storefront-password").fill(STORE_PASSWORD);
        await page.getByRole("button", { name: "Enter" }).click();
        await expect(page.getByRole("heading", { name: heroHeading })).toBeVisible({
          timeout: 30_000,
        });
        await visitor.close();
      });

      // 6. robots.txt while locked.
      await test.step("robots.txt disallows everything while the store is locked", async () => {
        const visitor = await browser.newContext({ baseURL: storefrontURL });
        const response = await visitor.request.get(`${storefrontURL}/robots.txt`);
        expect(response.ok()).toBe(true);
        expect(await response.text()).toMatch(/Disallow:\s*\/\s*(\n|$)/);
        await visitor.close();
      });
    } finally {
      if (locked && adminPage !== null) await setLock(adminPage, adminURL, false);
      if (adminContext !== null) await adminContext.close();
    }
  });
});

/** Opens the customize editor as the given seeded identity, signed in through the real flow. */
async function signedIn(browser: Browser, baseURL: string, email: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/online-store/themes/customize");
  await loginToAdminWeb(page, email, requireEnv("E2E_PASSWORD"));
  await expect(page).toHaveURL(/\/online-store\/themes\/customize/);
  await expect(page.frameLocator('iframe[title="Store preview"]').locator("body")).toBeVisible({
    timeout: 60_000,
  });
  return { context, page };
}

/** Admin only: the password card of Online Store → Preferences. */
async function setLock(page: Page, baseURL: string, on: boolean): Promise<void> {
  await page.goto(`${baseURL}/online-store/preferences`);
  const lock = page.getByRole("switch", {
    name: "Restrict access to visitors with the password",
  });
  await expect(lock).toBeVisible({ timeout: 30_000 });
  if ((await lock.getAttribute("aria-checked")) !== String(on)) await lock.click();
  if (on) await page.locator("#storefront-password").fill(STORE_PASSWORD);
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 30_000 });
}

/** A solid-colour PNG of `size` x `size` px, built here so the spec ships no binary fixture. */
function solidPng(size: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x66)]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required (no default) — set it before running the e2e suite.`);
  }
  return value;
}
