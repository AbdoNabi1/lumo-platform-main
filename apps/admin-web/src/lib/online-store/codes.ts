/** Ruling 9: the API prefixes its messages with `CODE:`; a conflict carries only the message. */
export function codeOf(message: string): string | null {
  return /^([A-Z][A-Z_]+):/.exec(message)?.[1] ?? null;
}
