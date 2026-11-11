import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SectionFocusListener } from "./section-focus-listener";

const ADMIN = "https://admin.morbeh.test";
const ID_A = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID_B = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e";

const realParent = Object.getOwnPropertyDescriptor(window, "parent");
const postMessage = vi.fn();
const scrollIntoView = vi.fn();
const frameParent = { postMessage };

function frame(parent: unknown) {
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
}
function send(origin: string, data: unknown, source: unknown = frameParent) {
  window.dispatchEvent(Object.assign(new Event("message"), { origin, source, data }));
}
const focusMessage = (id: string) => ({ type: "morbeh:focus-section", id });

beforeEach(() => {
  expect.hasAssertions();
  postMessage.mockReset();
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  document.body.innerHTML = `<section data-section-id="${ID_A}"></section><section data-section-id="${ID_B}"></section>`;
});
afterEach(() => {
  cleanup();
  if (realParent !== undefined) Object.defineProperty(window, "parent", realParent);
});

describe("SectionFocusListener", () => {
  it("tells the admin it is ready, exactly once, to the admin origin only", () => {
    frame(frameParent);
    render(<SectionFocusListener adminOrigin={ADMIN} />);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "morbeh:preview-ready" }, ADMIN);
  });

  it("posts nothing when the page is not framed", () => {
    render(<SectionFocusListener adminOrigin={ADMIN} />);
    expect(window.parent).toBe(window);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("focuses the named section and moves the mark from the previous one", () => {
    frame(frameParent);
    render(<SectionFocusListener adminOrigin={ADMIN} />);
    send(ADMIN, focusMessage(ID_A));
    const [a, b] = document.querySelectorAll("section");
    expect(a).toHaveAttribute("data-section-focused", "true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    send(ADMIN, focusMessage(ID_B));
    expect(a).not.toHaveAttribute("data-section-focused");
    expect(b).toHaveAttribute("data-section-focused", "true");
  });

  it("ignores another origin, a bad id, another sender, and an id that is not on the page", () => {
    frame(frameParent);
    render(<SectionFocusListener adminOrigin={ADMIN} />);
    send("https://evil.example", focusMessage(ID_A));
    send(ADMIN, focusMessage('x"] , body [y="'));
    send(ADMIN, focusMessage(ID_A), {});
    send(ADMIN, focusMessage("11111111-1111-4111-8111-111111111111"));
    expect(document.querySelector("[data-section-focused]")).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    frame(frameParent);
    const { unmount } = render(<SectionFocusListener adminOrigin={ADMIN} />);
    unmount();
    send(ADMIN, focusMessage(ID_A));
    expect(document.querySelector("[data-section-focused]")).toBeNull();
  });
});
