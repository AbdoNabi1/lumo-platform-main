import { useState } from "react";
import { vi } from "vitest";
import type { KnownSection } from "@platform/storefront-content";
import type { OnlineStoreImageDto, ThemeTargetsDto } from "@/lib/api/online-store";
import { en } from "@/messages/en";
import type { Dictionary } from "@/messages/en";
import type { Locale } from "@/lib/i18n";
import { SectionSettingsForm } from "./section-settings-form";

export const ID = "00000000-0000-4000-8000-0000000000aa";

export interface HarnessProps {
  readonly section: KnownSection;
  readonly errors?: Readonly<Record<string, string>>;
  readonly images?: Readonly<Record<string, OnlineStoreImageDto>>;
  readonly targets?: ThemeTargetsDto | null;
  readonly t?: Dictionary;
  readonly locale?: Locale;
  readonly path?: string;
  readonly onChange?: (settings: Readonly<Record<string, unknown>>) => void;
  readonly onImage?: (image: OnlineStoreImageDto & { id: string }) => void;
  readonly onTarget?: (kind: "collection" | "product" | "page", id: string, title: string) => void;
}

/** Keeps the section in state, as the editor does, so a form can be driven end to end. */
export function Harness({
  section: initial,
  errors = {},
  images = {},
  targets = null,
  t = en,
  locale = "en",
  path,
  onChange = vi.fn(),
  onImage = vi.fn(),
  onTarget = vi.fn(),
}: HarnessProps) {
  const [section, setSection] = useState(initial);
  return (
    <SectionSettingsForm
      t={t}
      locale={locale}
      section={section}
      images={images}
      targets={targets}
      errors={errors}
      disabled={false}
      {...(path === undefined ? {} : { path })}
      onChange={(settings) => {
        onChange(settings);
        setSection({ ...section, settings } as unknown as KnownSection);
      }}
      onImage={onImage}
      onTarget={onTarget}
    />
  );
}
