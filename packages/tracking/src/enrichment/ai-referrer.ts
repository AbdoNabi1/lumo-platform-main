/**
 * AI-assistant traffic source (Tracking P1-D8, gap A8): a visit that arrives from ChatGPT, Perplexity, Gemini,
 * Copilot, Claude and the like is named, so reports can say "AI assistants sent 4% of orders" instead of burying
 * it in `referral` or `direct`.
 *
 * Two signals, strongest first: an explicit `utm_source` (ChatGPT appends `utm_source=chatgpt.com` to the links it
 * shows) and the referrer host. Hosts are matched exactly or as a subdomain, never as a substring, so
 * `notchatgpt.com` and `google.com/search?q=chatgpt` are not AI traffic. The list needs upkeep as assistants appear;
 * it lives in this one table.
 */

export interface AiSource {
  /** Stable machine key stored on profiles and events (`chatgpt`, `perplexity`, …). */
  readonly key: string;
  readonly label: string;
  /** Referrer hosts (exact or subdomain). */
  readonly hosts: readonly string[];
  /** Extra `utm_source` spellings besides the hosts and the key itself. */
  readonly aliases?: readonly string[];
}

export const AI_SOURCES: readonly AiSource[] = [
  {
    key: "chatgpt",
    label: "ChatGPT",
    hosts: ["chatgpt.com", "chat.openai.com"],
    aliases: ["openai"],
  },
  { key: "perplexity", label: "Perplexity", hosts: ["perplexity.ai"] },
  {
    key: "gemini",
    label: "Gemini",
    hosts: ["gemini.google.com", "bard.google.com"],
    aliases: ["bard"],
  },
  {
    key: "copilot",
    label: "Microsoft Copilot",
    hosts: ["copilot.microsoft.com", "copilot.cloud.microsoft", "edgeservices.bing.com"],
    aliases: ["bing_copilot", "bingchat"],
  },
  { key: "claude", label: "Claude", hosts: ["claude.ai"], aliases: ["anthropic"] },
  { key: "deepseek", label: "DeepSeek", hosts: ["chat.deepseek.com", "deepseek.com"] },
  { key: "grok", label: "Grok", hosts: ["grok.com", "grok.x.ai"] },
  { key: "meta_ai", label: "Meta AI", hosts: ["meta.ai"], aliases: ["metaai"] },
  { key: "mistral", label: "Mistral Le Chat", hosts: ["chat.mistral.ai"] },
  { key: "you", label: "You.com", hosts: ["you.com"] },
  { key: "phind", label: "Phind", hosts: ["phind.com"] },
  { key: "poe", label: "Poe", hosts: ["poe.com"] },
  { key: "duckai", label: "Duck.ai", hosts: ["duck.ai"] },
  { key: "qwen", label: "Qwen", hosts: ["chat.qwen.ai"] },
  { key: "kimi", label: "Kimi", hosts: ["kimi.com", "kimi.moonshot.cn"] },
];

/** Short everyday words: only a host match counts for these, never a bare `utm_source=you`. */
const AMBIGUOUS_KEYS: ReadonlySet<string> = new Set(["you", "poe"]);

function hostOf(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || value.trim() === "") return undefined;
  const withoutScheme = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "");
  const host = withoutScheme
    .split(/[/?#]/u)[0]
    ?.replace(/^[^@]*@/u, "")
    .replace(/:\d+$/u, "")
    .toLowerCase()
    .replace(/^www\./u, "");
  return host === undefined || host === "" ? undefined : host;
}

function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

function bySource(source: string): AiSource | undefined {
  const normalised = source
    .trim()
    .toLowerCase()
    .replace(/^www\./u, "");
  if (normalised === "") return undefined;
  const asHost = hostOf(normalised);
  return AI_SOURCES.find(
    (entry) =>
      (entry.key === normalised && !AMBIGUOUS_KEYS.has(entry.key)) ||
      entry.aliases?.includes(normalised) === true ||
      entry.hosts.some((host) => asHost !== undefined && hostMatches(asHost, host)),
  );
}

export interface AiSourceSignals {
  readonly referrer?: string | null;
  readonly utmSource?: string | null;
}

/** The AI assistant a visit came from, or `undefined`. An explicit `utm_source` outranks the referrer. */
export function resolveAiSource(signals: AiSourceSignals): AiSource | undefined {
  if (signals.utmSource !== undefined && signals.utmSource !== null) {
    const fromUtm = bySource(signals.utmSource);
    if (fromUtm !== undefined) return fromUtm;
  }
  const host = hostOf(signals.referrer);
  if (host === undefined) return undefined;
  return AI_SOURCES.find((entry) => entry.hosts.some((candidate) => hostMatches(host, candidate)));
}

/** Just the key, for places that store a string. */
export function aiSourceKeyOf(signals: AiSourceSignals): string | undefined {
  return resolveAiSource(signals)?.key;
}
