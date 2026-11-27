import { describe, expect, it } from "vitest";
import { CLICK_ID_DEFINITIONS, CLICK_ID_NAMES } from "@platform/tracking";
import {
  CLICK_NAMES,
  CLICK_SPECS,
  captureLanding,
  deriveFbc,
  externalReferrer,
  fbclidOfFbc,
  isDocumentRequest,
  looksAutomated,
  mergeClickJar,
  readClickJar,
  writeClickJar,
  type ClickJar,
} from "./edge-capture";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const land = (query: string) => captureLanding(new URL(`https://shop.example/p/1?${query}`), NOW);

describe("the click-id table mirrors the tracking registry (the storefront cannot import it at the edge)", () => {
  it("has exactly the registry's names", () => {
    expect([...CLICK_NAMES].sort()).toEqual([...CLICK_ID_NAMES].sort());
  });

  it.each(CLICK_ID_NAMES)("%s: parameter, platform and window match", (name) => {
    expect(CLICK_SPECS[name].param).toBe(CLICK_ID_DEFINITIONS[name].param);
    expect(CLICK_SPECS[name].platform).toBe(CLICK_ID_DEFINITIONS[name].platform);
    expect(CLICK_SPECS[name].ttlDays).toBe(CLICK_ID_DEFINITIONS[name].ttlDays);
  });
});

describe("captureLanding — click ids", () => {
  it("derives _fbc from a fbclid in Meta's format with the landing's own time", () => {
    const landing = land("fbclid=IwAR0-abc_DEF");

    expect(landing.clicks).toEqual({ fbclid: "IwAR0-abc_DEF" });
    expect(landing.fbc).toBe(`fb.1.${String(NOW)}.IwAR0-abc_DEF`);
    expect(landing.fbc).toBe(deriveFbc("IwAR0-abc_DEF", NOW));
    expect(fbclidOfFbc(landing.fbc)).toBe("IwAR0-abc_DEF");
  });

  it("captures every platform's native id", () => {
    const landing = land(
      "gclid=G1&gbraid=G2&wbraid=G3&ttclid=T1&msclkid=M1&twclid=X1&li_fat_id=L1&epik=P1&fbclid=F1&ScCid=S1",
    );

    expect(landing.clicks).toEqual({
      fbclid: "F1",
      gclid: "G1",
      gbraid: "G2",
      wbraid: "G3",
      ttclid: "T1",
      msclkid: "M1",
      scclid: "S1",
      twclid: "X1",
      li_fat_id: "L1",
      epik: "P1",
    });
    expect(landing.restoredFromBackup).toEqual([]);
  });

  it.each(["ScCid", "sccid", "SCCID", "sc_click_id", "Sc_Click_Id", "scclid"])(
    "Snapchat alias %s becomes scclid, and the page URL carries the registry's ScCid",
    (alias) => {
      const landing = land(`${alias}=snap-click-9`);

      expect(landing.clicks).toEqual({ scclid: "snap-click-9" });
      expect(new URL(landing.pageUrl).searchParams.get("ScCid")).toBe("snap-click-9");
    },
  );

  it("matches parameter names case-insensitively", () => {
    expect(land("GCLID=abc&FbClId=def").clicks).toEqual({ gclid: "abc", fbclid: "def" });
  });

  it("keeps a TikTok click id whole up to 1000 characters and refuses longer (never truncates)", () => {
    expect(land(`ttclid=${"T".repeat(1000)}`).clicks.ttclid).toHaveLength(1000);
    expect(land(`ttclid=${"T".repeat(1001)}`).clicks).toEqual({});
    expect(land(`gclid=${"g".repeat(513)}`).clicks).toEqual({});
  });

  it("refuses values that are not click-id shaped, and keeps a literal plus", () => {
    expect(land("gclid=a%20b").clicks).toEqual({});
    expect(land("gclid=%3Cscript%3E").clicks).toEqual({});
    expect(land("gclid=a;b").clicks).toEqual({});
    expect(land("gclid=").clicks).toEqual({});
    expect(land("gclid=ab+cd").clicks).toEqual({ gclid: "ab+cd" });
  });

  it("the first occurrence of a parameter wins", () => {
    expect(land("gclid=first&gclid=second").clicks).toEqual({ gclid: "first" });
  });
});

describe("captureLanding — backup parameters (Click ID Restorer)", () => {
  it("swaps a backup in when the browser stripped the native parameter", () => {
    const landing = land(
      "mb_gclid=restored-g&mb_fbclid=restored-f&mb_ttclid=restored-t&mb_sccid=restored-s",
    );

    expect(landing.clicks).toEqual({
      gclid: "restored-g",
      fbclid: "restored-f",
      ttclid: "restored-t",
      scclid: "restored-s",
    });
    expect([...landing.restoredFromBackup].sort()).toEqual(["fbclid", "gclid", "scclid", "ttclid"]);
    expect(landing.fbc).toBe(`fb.1.${String(NOW)}.restored-f`);
  });

  it("the page URL the runtime sees has the native parameter and none of the backups", () => {
    const landing = land("mb_gclid=restored-g&mb_sccid=restored-s&keep=1");
    const url = new URL(landing.pageUrl);

    expect(url.searchParams.get("gclid")).toBe("restored-g");
    expect(url.searchParams.get("ScCid")).toBe("restored-s");
    expect(url.searchParams.get("keep")).toBe("1");
    expect([...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("mb_"))).toBe(
      false,
    );
  });

  it("a native parameter wins over its backup", () => {
    const landing = land("gclid=native&mb_gclid=backup");

    expect(landing.clicks).toEqual({ gclid: "native" });
    expect(landing.restoredFromBackup).toEqual([]);
    expect(new URL(landing.pageUrl).searchParams.get("gclid")).toBe("native");
  });

  it("falls back to the backup when the native value is unusable", () => {
    const landing = land("gclid=bad%20value&mb_gclid=good");

    expect(landing.clicks).toEqual({ gclid: "good" });
    expect(landing.restoredFromBackup).toEqual(["gclid"]);
  });

  it("matches backups case-insensitively and the other platforms too", () => {
    expect(land("MB_GCLID=a&mb_msclkid=b&mb_wbraid=c").clicks).toEqual({
      gclid: "a",
      msclkid: "b",
      wbraid: "c",
    });
  });

  it("drops the fragment and bounds the URL", () => {
    const landing = captureLanding(
      new URL(`https://shop.example/?gclid=a&x=${"y".repeat(5000)}#frag`),
      NOW,
    );

    expect(landing.pageUrl.length).toBeLessThanOrEqual(2048);
    expect(landing.pageUrl).not.toContain("#frag");
  });
});

describe("captureLanding — campaign", () => {
  it("captures UTMs, cleaned and bounded", () => {
    const landing = land(
      `utm_source=facebook&utm_medium=cpc&UTM_CAMPAIGN=${"c".repeat(300)}&utm_content=a%00b&utm_term=%20%20`,
    );

    expect(landing.utm.utmSource).toBe("facebook");
    expect(landing.utm.utmMedium).toBe("cpc");
    expect(landing.utm.utmCampaign).toHaveLength(200);
    expect(landing.utm.utmContent).toBe("ab");
    expect(landing.utm).not.toHaveProperty("utmTerm");
    expect(landing.hasSignal).toBe(true);
  });

  it("a plain page has no signal", () => {
    const landing = land("page=2&sort=price");

    expect(landing.hasSignal).toBe(false);
    expect(landing.clicks).toEqual({});
    expect(landing.fbc).toBeUndefined();
  });
});

describe("the click jar", () => {
  const jarOf = (entries: Record<string, unknown>) => JSON.stringify(entries);

  it("reads valid, unexpired entries and drops everything else", () => {
    const jar = readClickJar(
      jarOf({
        gclid: { v: "g-1", t: NOW - DAY },
        ttclid: { v: "t-1", t: NOW - 100 * DAY }, // past 90 days
        scclid: { v: "s-1", t: NOW - 29 * DAY }, // past Snap's 28
        twclid: { v: "x-1", t: NOW - 29 * DAY }, // inside X's 30
        epik: { v: "bad value", t: NOW },
        msclkid: { v: "m-1", t: NOW + DAY }, // future
        fbclid: "nope",
        unknown: { v: "u", t: NOW },
      }),
      NOW,
    );

    expect(jar).toEqual({
      gclid: { v: "g-1", t: NOW - DAY },
      twclid: { v: "x-1", t: NOW - 29 * DAY },
    });
  });

  it.each([undefined, "", "not json", "[]", "null", "123"])("%j reads as an empty jar", (raw) => {
    expect(readClickJar(raw, NOW)).toEqual({});
  });

  it("a new click replaces everything of that platform and leaves the others", () => {
    const before: ClickJar = {
      gclid: { v: "old-g", t: NOW - DAY },
      wbraid: { v: "old-w", t: NOW - DAY },
      ttclid: { v: "old-t", t: NOW - DAY },
    };

    const after = mergeClickJar(before, { gclid: "new-g", fbclid: "new-f" }, NOW);

    expect(after).toEqual({
      gclid: { v: "new-g", t: NOW },
      fbclid: { v: "new-f", t: NOW },
      ttclid: { v: "old-t", t: NOW - DAY },
    });
  });

  it("a TikTok click replaces the older one, untruncated", () => {
    const long = "T".repeat(1000);
    const after = mergeClickJar({ ttclid: { v: "old", t: NOW - DAY } }, { ttclid: long }, NOW);

    expect(after.ttclid).toEqual({ v: long, t: NOW });
    expect(readClickJar(writeClickJar(after), NOW).ttclid?.v).toBe(long);
  });

  it("round-trips, and stays inside a cookie by dropping the oldest clicks first", () => {
    const full: ClickJar = {};
    CLICK_NAMES.forEach((name, index) => {
      full[name] = {
        v: `${name}-`.padEnd(CLICK_SPECS[name].maxLength, "x"),
        t: NOW - index * 1000,
      };
    });

    const written = writeClickJar(full);

    expect(encodeURIComponent(written).length).toBeLessThanOrEqual(3500);
    const back = readClickJar(written, NOW);
    expect(Object.keys(back).length).toBeGreaterThan(0);
    // Whatever was dropped, the newest click survived.
    expect(back.fbclid).toBeDefined();
    expect(writeClickJar(readClickJar(written, NOW))).toBe(written);
  });
});

describe("request classification", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("a document navigation is a GET that accepts HTML", () => {
    expect(isDocumentRequest("GET", headers({ accept: "text/html,application/xhtml+xml" }))).toBe(
      true,
    );
    expect(isDocumentRequest("POST", headers({ accept: "text/html" }))).toBe(false);
    expect(isDocumentRequest("GET", headers({ accept: "image/avif,image/webp,*/*" }))).toBe(false);
    expect(isDocumentRequest("GET", headers({}))).toBe(false);
  });

  it("RSC fetches and prefetches are not navigations", () => {
    expect(isDocumentRequest("GET", headers({ accept: "text/html", rsc: "1" }))).toBe(false);
    expect(
      isDocumentRequest("GET", headers({ accept: "text/html", "next-router-prefetch": "1" })),
    ).toBe(false);
    expect(isDocumentRequest("GET", headers({ accept: "text/html", purpose: "prefetch" }))).toBe(
      false,
    );
    expect(
      isDocumentRequest(
        "GET",
        headers({ accept: "text/html", "sec-purpose": "prefetch;prerender" }),
      ),
    ).toBe(false);
  });

  it("crawlers and tools are skipped; real browsers are not", () => {
    for (const ua of [
      null,
      "",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1",
      "curl/8.4.0",
      "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/119 HeadlessChrome/119 Safari/537.36",
      "python-requests/2.31",
    ]) {
      expect(looksAutomated(ua), String(ua)).toBe(true);
    }
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36",
    ]) {
      expect(looksAutomated(ua), ua).toBe(false);
    }
  });

  it("only another site is a referrer", () => {
    expect(externalReferrer("https://www.facebook.com/", "shop.example")).toBe(
      "https://www.facebook.com/",
    );
    expect(externalReferrer("https://shop.example/p/1", "shop.example")).toBeUndefined();
    expect(externalReferrer("https://SHOP.example/p/1", "shop.example")).toBeUndefined();
    expect(externalReferrer("javascript:alert(1)", "shop.example")).toBeUndefined();
    expect(externalReferrer("not a url", "shop.example")).toBeUndefined();
    expect(externalReferrer(null, "shop.example")).toBeUndefined();
    expect(externalReferrer("", "shop.example")).toBeUndefined();
  });
});
