import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { shellTag } from "@/lib/shell-tag";
import { storefrontSecrets } from "@/lib/storefront-env";

const SHOP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/**
 * Decision 33: admin-web calls this server-to-server after a save that changes the live storefront.
 * Constant-time secret compare (on digests, so lengths never leak); only `os:<shopId>` is touched.
 * A missing, wrong or unconfigured secret all get the same bare 401: with no server secret the route
 * refuses everything, it never opens.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = storefrontSecrets().revalidateSecret;
  const given = request.headers.get("x-revalidate-secret");
  if (secret === null || given === null || !timingSafeEqual(digest(given), digest(secret))) {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { shopId?: unknown } | null;
  const shopId = body?.shopId;
  if (typeof shopId !== "string" || !SHOP_ID.test(shopId)) {
    return Response.json({ code: "INVALID_SHOP" }, { status: 400 });
  }
  revalidateTag(shellTag(shopId));
  return Response.json({ revalidated: true });
}
