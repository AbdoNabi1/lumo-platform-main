import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getLockedView, getRequestShell } from "@/lib/request-locale";
import { siteOrigin } from "@/lib/site-origin";

/** Spec 2.8: the pages crawlers have no business in. */
const PRIVATE_PATHS = ["/cart", "/checkout", "/account", "/c/", "/password"];

/**
 * `robots.txt`. A locked store disallows everything and names no sitemap (Decision 35). The locked
 * view comes first (preflight 2): the gate's own verdict, so a failed shell read (the unlocked
 * FALLBACK_SHELL) cannot open a locked store to crawlers, and no Runtime read is made.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const locked = (await getLockedView()) || (await getRequestShell()).locked;
  if (locked) return { rules: [{ userAgent: "*", disallow: "/" }] };
  const origin = siteOrigin((await headers()).get("host"), process.env.NODE_ENV);
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] }],
    ...(origin === null ? {} : { sitemap: `${origin}/sitemap.xml` }),
  };
}
