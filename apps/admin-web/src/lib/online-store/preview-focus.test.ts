import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECTION_FOCUS_MESSAGE } from "@platform/storefront-content";
import { postFocus, previewOrigin, PREVIEW_READY_MESSAGE } from "./preview-focus";

const ID = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  expect.hasAssertions();
});

describe("previewOrigin", () => {
  it("is the origin of the preview url, without path, query or token", () => {
    expect(previewOrigin("https://shop.example/?preview=t&v=3")).toBe("https://shop.example");
    expect(previewOrigin("http://localhost:3001/x")).toBe("http://localhost:3001");
  });
  it("is null for a bad url or a non-http scheme", () => {
    expect(previewOrigin("not a url")).toBeNull();
    expect(previewOrigin("")).toBeNull();
    expect(previewOrigin("javascript:alert(1)")).toBeNull();
    expect(previewOrigin("data:text/html,x")).toBeNull();
  });
});

describe("postFocus", () => {
  const frameWith = (postMessage: (message: unknown, origin: string) => void) =>
    ({ contentWindow: { postMessage } }) as unknown as Pick<HTMLIFrameElement, "contentWindow">;

  it("posts the focus message to the preview origin", () => {
    const postMessage = vi.fn();
    const sent = postFocus(frameWith(postMessage), "https://shop.example/?preview=t&v=3", ID);
    expect(sent).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      { type: SECTION_FOCUS_MESSAGE, id: ID },
      "https://shop.example",
    );
    expect(SECTION_FOCUS_MESSAGE).toBe("morbeh:focus-section");
  });

  it("does nothing without a frame, a window or a usable url", () => {
    const postMessage = vi.fn();
    expect(postFocus(null, "https://shop.example/", ID)).toBe(false);
    expect(postFocus({ contentWindow: null }, "https://shop.example/", ID)).toBe(false);
    expect(postFocus(frameWith(postMessage), "nope", ID)).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("never posts with the wildcard origin", () => {
    const postMessage = vi.fn();
    postFocus(frameWith(postMessage), "https://shop.example/?a=1", ID);
    expect(postMessage.mock.calls.every(([, origin]) => origin !== "*")).toBe(true);
  });

  it("the ready message type is the storefront's", () => {
    expect(PREVIEW_READY_MESSAGE).toBe("morbeh:preview-ready");
  });
});
