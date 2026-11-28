import { describe, expect, it } from "vitest";
import { enrichAttribution } from "../pipeline/enrichment";
import { resolveChannel } from "../pipeline/channel-resolver";
import { AI_SOURCES, aiSourceKeyOf, resolveAiSource } from "./ai-referrer";

describe("resolveAiSource — referrer hosts", () => {
  it.each([
    ["https://chatgpt.com/", "chatgpt"],
    ["https://chat.openai.com/c/abc", "chatgpt"],
    ["https://www.perplexity.ai/search/xyz", "perplexity"],
    ["https://gemini.google.com/app", "gemini"],
    ["https://copilot.microsoft.com/chats/1", "copilot"],
    ["https://claude.ai/chat/abc", "claude"],
    ["https://chat.deepseek.com/", "deepseek"],
    ["https://grok.com/", "grok"],
    ["https://meta.ai/", "meta_ai"],
    ["https://chat.mistral.ai/chat", "mistral"],
    ["https://us.chatgpt.com/", "chatgpt"],
  ])("%s → %s", (referrer, key) => {
    expect(aiSourceKeyOf({ referrer })).toBe(key);
  });

  it("is not fooled by lookalikes, search pages or other Google/Microsoft/Bing hosts", () => {
    for (const referrer of [
      "https://notchatgpt.com/",
      "https://chatgpt.com.evil.example/",
      "https://www.google.com/search?q=chatgpt.com",
      "https://gemini.google.com.evil.example/",
      "https://www.bing.com/search?q=claude.ai",
      "https://www.microsoft.com/",
      "https://shop.example.com/?ref=perplexity.ai",
      "",
      undefined,
    ]) {
      expect(resolveAiSource({ referrer })).toBeUndefined();
    }
  });

  it("tolerates ports, userinfo and a missing scheme", () => {
    expect(aiSourceKeyOf({ referrer: "chatgpt.com/share/1" })).toBe("chatgpt");
    expect(aiSourceKeyOf({ referrer: "https://claude.ai:443/chat" })).toBe("claude");
  });
});

describe("resolveAiSource — utm_source", () => {
  it.each([
    ["chatgpt.com", "chatgpt"],
    ["ChatGPT", "chatgpt"],
    ["perplexity", "perplexity"],
    ["perplexity.ai", "perplexity"],
    ["claude", "claude"],
    ["copilot.microsoft.com", "copilot"],
    ["gemini", "gemini"],
  ])("utm_source=%s → %s", (utmSource, key) => {
    expect(aiSourceKeyOf({ utmSource })).toBe(key);
  });

  it("outranks the referrer", () => {
    expect(aiSourceKeyOf({ utmSource: "perplexity", referrer: "https://chatgpt.com/" })).toBe(
      "perplexity",
    );
  });

  it("everyday words are not AI sources without a host", () => {
    expect(aiSourceKeyOf({ utmSource: "you" })).toBeUndefined();
    expect(aiSourceKeyOf({ utmSource: "poe" })).toBeUndefined();
    expect(aiSourceKeyOf({ utmSource: "newsletter" })).toBeUndefined();
    expect(aiSourceKeyOf({ utmSource: "google" })).toBeUndefined();
    expect(aiSourceKeyOf({ utmSource: "you.com" })).toBe("you");
  });

  it("every table row has a unique key and at least one host", () => {
    expect(new Set(AI_SOURCES.map((entry) => entry.key)).size).toBe(AI_SOURCES.length);
    for (const entry of AI_SOURCES) expect(entry.hosts.length).toBeGreaterThan(0);
  });
});

describe("AI sources as a channel", () => {
  it("a referrer from an assistant is the ai_assistant channel with the source named", () => {
    expect(resolveChannel({ referrer: "https://chatgpt.com/" })).toMatchObject({
      channelGroup: "ai_assistant",
      basis: "referrer",
      source: "chatgpt",
    });
    expect(resolveChannel({ referrer: "https://www.perplexity.ai/" })).toMatchObject({
      channelGroup: "ai_assistant",
      source: "perplexity",
    });
  });

  it("utm_source=chatgpt.com with no medium (what ChatGPT appends) is ai_assistant", () => {
    expect(resolveChannel({ utmSource: "chatgpt.com" })).toMatchObject({
      channelGroup: "ai_assistant",
      basis: "utm_source",
      source: "chatgpt",
    });
  });

  it("loose mediums do not hide it, paid and email do", () => {
    expect(resolveChannel({ utmSource: "chatgpt.com", utmMedium: "referral" }).channelGroup).toBe(
      "ai_assistant",
    );
    expect(
      resolveChannel({ referrer: "https://claude.ai/", utmMedium: "organic" }).channelGroup,
    ).toBe("ai_assistant");
    expect(resolveChannel({ utmSource: "chatgpt.com", utmMedium: "cpc" }).channelGroup).toBe(
      "paid_search",
    );
    expect(resolveChannel({ utmSource: "claude", utmMedium: "email" }).channelGroup).toBe("email");
  });

  it("a click id still outranks an AI referrer; other referrers are unchanged", () => {
    expect(
      resolveChannel({ referrer: "https://chatgpt.com/", clickIds: ["gclid"] }).channelGroup,
    ).toBe("paid_search");
    expect(resolveChannel({ referrer: "https://www.google.com/" }).channelGroup).toBe(
      "organic_search",
    );
    expect(resolveChannel({ referrer: "https://www.facebook.com/" }).channelGroup).toBe(
      "organic_social",
    );
    expect(resolveChannel({}).channelGroup).toBe("direct");
  });

  it("lands on the attribution block as aiSource, from the referrer or from the persisted landing", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    const direct = enrichAttribution({
      context: { attribution: { referrer: "https://claude.ai/chat/1" } },
      now,
    });
    expect(direct.aiSource).toBe("claude");
    expect(direct.channelGroup).toBe("ai_assistant");

    // A later purchase carries no referrer of its own: the landing the profile remembers supplies it.
    const later = enrichAttribution({
      context: { attribution: {} },
      persisted: { referrer: "https://chatgpt.com/" },
      now,
    });
    expect(later.aiSource).toBe("chatgpt");

    expect(enrichAttribution({ context: { attribution: {} }, now }).aiSource).toBeUndefined();
  });
});
