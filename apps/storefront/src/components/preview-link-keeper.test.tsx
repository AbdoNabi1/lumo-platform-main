import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import { fireEvent, render, screen } from "@testing-library/react";
import { PreviewLinkKeeper } from "./preview-link-keeper";

// jsdom cannot navigate; stop the default action of the clicks the keeper leaves alone (bubble phase,
// so the keeper's capture-phase listener still sees an untouched event).
const noNavigation = (event: Event) => event.preventDefault();
beforeEach(() => document.addEventListener("click", noNavigation));
afterEach(() => {
  document.removeEventListener("click", noNavigation);
  vi.restoreAllMocks();
});

describe("PreviewLinkKeeper (Ruling 16)", () => {
  it("turns an internal link click into a full navigation that keeps ?preview=", () => {
    const assign = vi.fn();
    render(
      <>
        <PreviewLinkKeeper token="tok" navigate={assign} />
        <Link href="/products/lamp?c=1">lamp</Link>
        <a href="https://instagram.com/x">ig</a>
        <a href="/cart" target="_blank">
          new tab
        </a>
      </>,
    );
    fireEvent.click(screen.getByText("lamp"));
    expect(assign).toHaveBeenCalledWith("/products/lamp?c=1&preview=tok");
    fireEvent.click(screen.getByText("ig"));
    fireEvent.click(screen.getByText("new tab"));
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("runs before React's own handlers, so a client-side <Link> cannot drop the token", () => {
    const assign = vi.fn();
    const reactHandler = vi.fn();
    render(
      <>
        <PreviewLinkKeeper token="tok" navigate={assign} />
        <Link href="/collections/new" onClick={reactHandler}>
          <span>inner</span>
        </Link>
      </>,
    );
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByText("inner").dispatchEvent(event);
    expect(assign).toHaveBeenCalledWith("/collections/new?preview=tok");
    expect(reactHandler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves modified clicks, downloads, in-page anchors and other buttons alone", () => {
    const assign = vi.fn();
    render(
      <>
        <PreviewLinkKeeper token="tok" navigate={assign} />
        <Link href="/products/lamp">lamp</Link>
        <a href="/file.pdf" download>
          file
        </a>
        <a href={`${window.location.pathname}${window.location.search}#reviews`}>reviews</a>
      </>,
    );
    fireEvent.click(screen.getByText("lamp"), { ctrlKey: true });
    fireEvent.click(screen.getByText("lamp"), { metaKey: true });
    fireEvent.click(screen.getByText("lamp"), { shiftKey: true });
    fireEvent.click(screen.getByText("lamp"), { button: 1 });
    fireEvent.click(screen.getByText("file"));
    fireEvent.click(screen.getByText("reviews"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const assign = vi.fn();
    const { unmount } = render(<PreviewLinkKeeper token="tok" navigate={assign} />);
    unmount();
    const link = document.createElement("a");
    link.href = "/cart";
    document.body.append(link);
    link.click();
    link.remove();
    expect(assign).not.toHaveBeenCalled();
  });
});
