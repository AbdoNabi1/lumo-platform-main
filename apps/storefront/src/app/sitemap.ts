import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getLockedView, getRequestShell } from "@/lib/request-locale";
import { siteOrigin } from "@/lib/site-origin";
import { getSitemapPaths } from "@/lib/sitemap";

/**
 * `sitemap.xml` on the request's host. A locked store's is empty and reads nothing (Decision 35),
 * the gate's locked view first (preflight 2). A failed read or an unusable host is an empty
 * sitemap, never an error page; the failure itself was not cached (`getSitemapPaths`).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const locked = (await getLockedView()) || (await getRequestShell()).locked;
  if (locked) return [];
  const origin = siteOrigin((await headers()).get("host"), process.env.NODE_ENV);
  if (origin === null) return [];
  let paths;
  try {
    paths = await getSitemapPaths();
  } catch {
    return [];
  }
  return paths.map(({ path, lastModified }) =>
    lastModified === undefined
      ? { url: `${origin}${path}` }
      : { url: `${origin}${path}`, lastModified },
  );
}
