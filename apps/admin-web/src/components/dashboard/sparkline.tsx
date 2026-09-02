import { cn } from "@platform/ui";

/**
 * KPI trend spark. Inline SVG, no charting dependency — the whole mark is one polyline
 * over normalised 0–1 samples.
 *
 * Decorative: the KPI's value and delta already state the same thing in text, so the
 * graphic is hidden from assistive technology rather than duplicating it.
 */
export function Sparkline({
  points,
  className,
}: {
  readonly points: readonly number[];
  readonly className?: string;
}) {
  if (points.length < 2) return null;

  const width = 100;
  const height = 32;
  const padding = 3;
  const step = width / (points.length - 1);

  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = height - padding - value * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-24 shrink-0 overflow-visible", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
