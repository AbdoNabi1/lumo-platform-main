/** Ruling 16: shell links keep the preview token. Relative paths only (they are ours). */
export function withPreview(path: string, token: string | null): string {
  if (token === null) return path;
  const url = new URL(path, "http://preview.invalid");
  url.searchParams.set("preview", token);
  return `${url.pathname}${url.search}${url.hash}`;
}
