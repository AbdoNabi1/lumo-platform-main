import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LocalizedText } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { RichTextEditor } from "./rich-text-editor";

afterEach(cleanup);

function Harness({
  t,
  locale,
  initial,
  max = 100_000,
  errors,
  disabled,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly initial: LocalizedText;
  readonly max?: number;
  readonly errors?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
}) {
  const [value, setValue] = useState<LocalizedText>(initial);
  return (
    <>
      <RichTextEditor
        t={t}
        locale={locale}
        name="body"
        label="Content"
        value={value}
        max={max}
        disabled={disabled}
        errors={errors}
        onChange={setValue}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId("value").textContent ?? "{}") as LocalizedText;
const visibleTextarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;

describe("RichTextEditor (spec 2.7)", () => {
  it("reports an unsafe link with its line, in the admin's language (Ruling 9)", () => {
    render(<Harness t={ar} locale="ar" initial={{ ar: "سطر\n[x](javascript:alert(1))" }} />);
    expect(screen.getByText(/سطر 2/)).toBeInTheDocument();
    expect(screen.getByText(/سطر 2/).textContent).toBe(
      ar.richText.unsafeLink.replace("{line}", "2"),
    );
  });

  it("the Preview tab renders headings and links as the storefront does", () => {
    render(
      <Harness t={en} locale="en" initial={{ en: "## Returns\n[Contact](/pages/contact)" }} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: en.richText.preview }));
    expect(screen.getByRole("heading", { level: 2, name: "Returns" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/pages/contact");
    fireEvent.click(screen.getByRole("tab", { name: en.richText.write }));
    expect(visibleTextarea().value).toBe("## Returns\n[Contact](/pages/contact)");
  });

  it("an external link in Preview opens in a new tab without an opener", () => {
    render(<Harness t={en} locale="en" initial={{ en: "[Us](https://nour.example/)" }} />);
    fireEvent.click(screen.getByRole("tab", { name: en.richText.preview }));
    const link = screen.getByRole("link", { name: "Us" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("the toolbar inserts Morbeh text at the selection and keeps it selected", () => {
    render(<Harness t={en} locale="en" initial={{ en: "a big sale" }} />);
    const textarea = visibleTextarea();
    textarea.setSelectionRange(2, 5);
    fireEvent.click(screen.getByRole("button", { name: en.richText.bold }));
    expect(valueOf().en).toBe("a **big** sale");
    expect(textarea.value).toBe("a **big** sale");
    expect(document.activeElement).toBe(textarea);
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 7]);
  });

  it("offers all seven tools, each named in the admin's language", () => {
    render(<Harness t={ar} locale="ar" initial={{}} />);
    for (const name of [
      ar.richText.h2,
      ar.richText.h3,
      ar.richText.bold,
      ar.richText.italic,
      ar.richText.bullets,
      ar.richText.numbers,
      ar.richText.link,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("the link tool selects the address placeholder for typing", () => {
    render(<Harness t={en} locale="en" initial={{ en: "call us" }} />);
    const textarea = visibleTextarea();
    textarea.setSelectionRange(0, 7);
    fireEvent.click(screen.getByRole("button", { name: en.richText.link }));
    expect(textarea.value).toBe("[call us](https://)");
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe("https://");
  });

  it("counts characters against the limit and flags TOO_LONG", () => {
    render(<Harness t={en} locale="en" initial={{ en: "a".repeat(11) }} max={10} />);
    expect(
      screen.getByText(en.richText.tooLong.replace("{count}", "11").replace("{max}", "10")),
    ).toBeInTheDocument();
    fireEvent.change(visibleTextarea(), { target: { value: "a".repeat(10) } });
    expect(screen.queryByText(/Too long/)).toBeNull();
    expect(screen.getByText("10/10")).toBeInTheDocument();
  });

  it("hostile text in Preview is text, never markup", () => {
    render(<Harness t={en} locale="en" initial={{ en: "<img src=x onerror=alert(1)>" }} />);
    fireEvent.click(screen.getByRole("tab", { name: en.richText.preview }));
    expect(document.querySelector("img")).toBeNull();
    const preview = screen.getByRole("tabpanel", { name: en.richText.preview });
    expect(within(preview).getByText("<img src=x onerror=alert(1)>").tagName).toBe("P");
  });

  it("keeps both languages mounted, so a form submits body.ar and body.en", () => {
    const { container } = render(
      <Harness t={en} locale="en" initial={{ ar: "عربي", en: "English" }} />,
    );
    const ar = container.querySelector<HTMLTextAreaElement>('textarea[name="body.ar"]');
    const english = container.querySelector<HTMLTextAreaElement>('textarea[name="body.en"]');
    expect(ar?.value).toBe("عربي");
    expect(english?.value).toBe("English");
    expect(ar).toHaveAttribute("dir", "auto");
  });

  it("shows a server field error under its own tab, tied to the textarea", () => {
    render(
      <Harness
        t={en}
        locale="en"
        initial={{ ar: "x" }}
        errors={{ "body.ar": en.richText.unsafeLinkSaved }}
      />,
    );
    // The English tab is open: the Arabic error is flagged on its tab, not shown here.
    expect(screen.getByText(en.richText.unsafeLinkSaved)).not.toBeVisible();
    const arabicTab = screen.getByRole("tab", { name: en.onlineStorePreferences.arabic });
    expect(arabicTab).toHaveAttribute("data-invalid", "true");
    fireEvent.click(arabicTab);
    const textarea = visibleTextarea();
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    const describedBy = textarea.getAttribute("aria-describedby") ?? "";
    const error = screen.getByText(en.richText.unsafeLinkSaved);
    expect(describedBy.split(" ")).toContain(error.id);
  });

  it("ties the local link issues to the textarea too", () => {
    render(<Harness t={en} locale="en" initial={{ en: "[x](javascript:1)" }} />);
    const textarea = visibleTextarea();
    const issues = screen.getByText(en.richText.unsafeLink.replace("{line}", "1"));
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect((textarea.getAttribute("aria-describedby") ?? "").split(" ")).toContain(
      issues.closest("[id]")?.id,
    );
  });

  it("two editors on one screen never share an element id", () => {
    const { container } = render(
      <>
        <Harness t={en} locale="en" initial={{ en: "[x](javascript:1)" }} />
        <Harness t={en} locale="en" initial={{ en: "[y](javascript:2)" }} />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is read-only when disabled: no tool can change the text", () => {
    render(<Harness t={en} locale="en" initial={{ en: "x" }} disabled />);
    expect(visibleTextarea()).toBeDisabled();
    const toolbar = screen.getByRole("toolbar");
    for (const button of within(toolbar).getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("a new value from the server replaces the text", () => {
    function Outer() {
      const [value, setValue] = useState<LocalizedText>({ en: "old" });
      return (
        <>
          <RichTextEditor t={en} locale="en" name="body" label="Content" value={value} max={100} />
          <button type="button" onClick={() => setValue({ en: "from the template" })}>
            replace
          </button>
        </>
      );
    }
    render(<Outer />);
    fireEvent.click(screen.getByRole("button", { name: "replace" }));
    expect(visibleTextarea().value).toBe("from the template");
  });
});
