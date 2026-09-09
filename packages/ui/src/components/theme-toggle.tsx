"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

interface ThemeOption {
  readonly value: "light" | "system" | "dark";
  readonly label: string;
  readonly Icon: LucideIcon;
}

const OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/**
 * Morbeh theme control — a three-way segmented control over light / system / dark.
 *
 * Exposed as a radio group rather than three buttons: only one theme can be active, and
 * arrow-key navigation between the segments is what a radio group already gives us.
 * Before hydration `theme` is unknown, so no segment is pre-selected — this avoids
 * asserting a selection the server could not have known.
 */
export function ThemeToggle({ className, ...props }: React.ComponentProps<"div">) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn("bg-secondary inline-flex items-center gap-1 rounded-full p-1", className)}
      {...props}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-full",
              "duration-(--duration-fast) transition-[background-color,color,box-shadow] ease-out",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
              focusRing,
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
