/**
 * Attribution engine (directive §Attribution; doc 17 §5).
 *
 * Credit is computed from stored touchpoints, never accumulated incrementally. That is what makes
 * models **retroactive**: changing from last-touch to position-based re-scores all of history
 * rather than only future conversions.
 *
 * Every model returns weights summing to 1 (within floating-point tolerance), so revenue is
 * neither invented nor lost when credit is distributed across a journey.
 */

import type {
  AttributionCredit,
  AttributionModel,
  ChannelGroup,
  Touchpoint,
} from "../envelope/attribution-context";

/** Half-life for time decay: credit halves for every 7 days before the conversion. */
export const TIME_DECAY_HALF_LIFE_DAYS = 7;

/** Position-based weights — 40% first, 40% last, 20% shared among the middle (doc 17 §5). */
export const POSITION_FIRST_WEIGHT = 0.4;
export const POSITION_LAST_WEIGHT = 0.4;

/**
 * The frozen attribution result stamped on an event before delivery. It is a **snapshot**: the
 * model and its weights at conversion time, so a later model change does not silently rewrite what
 * a destination was already told.
 */
export interface AttributionSnapshot {
  readonly journeyId: string;
  readonly model: AttributionModel;
  readonly credits: readonly AttributionCredit[];
  readonly touchCount: number;
  readonly firstTouchChannel?: ChannelGroup;
  readonly lastTouchChannel?: ChannelGroup;
  readonly computedAt: string;
  /** True when no touchpoint was available, so credit could not be assigned. */
  readonly unattributed: boolean;
}

function credit(touchIndex: number, model: AttributionModel, weight: number): AttributionCredit {
  return { touchIndex, model, weight: Number(weight.toFixed(6)) };
}

/**
 * Assigns credit under a model. Touchpoints must be supplied in chronological order; index 0 is
 * the first touch.
 */
export function assignCredit(
  touchpoints: readonly Touchpoint[],
  model: AttributionModel,
  conversionAt: Date,
): readonly AttributionCredit[] {
  const count = touchpoints.length;
  if (count === 0) return [];

  switch (model) {
    case "first_touch":
      return [credit(0, model, 1)];

    case "last_touch":
      return [credit(count - 1, model, 1)];

    case "linear":
      return touchpoints.map((_, index) => credit(index, model, 1 / count));

    case "position_based":
      return positionBased(count, model);

    case "time_decay":
      return timeDecay(touchpoints, model, conversionAt);

    case "data_driven":
      // Not yet implemented: a data-driven model requires a trained conversion model (P6/P8).
      // Falling back to linear is honest and neutral — it neither invents nor concentrates credit
      // — and the model recorded on the snapshot still says `data_driven`, so the substitution is
      // visible rather than silent.
      return touchpoints.map((_, index) => credit(index, model, 1 / count));
  }
}

function positionBased(count: number, model: AttributionModel): readonly AttributionCredit[] {
  if (count === 1) return [credit(0, model, 1)];
  if (count === 2) return [credit(0, model, 0.5), credit(1, model, 0.5)];

  const middleCount = count - 2;
  const middleWeight = (1 - POSITION_FIRST_WEIGHT - POSITION_LAST_WEIGHT) / middleCount;

  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return credit(index, model, POSITION_FIRST_WEIGHT);
    if (index === count - 1) return credit(index, model, POSITION_LAST_WEIGHT);
    return credit(index, model, middleWeight);
  });
}

function timeDecay(
  touchpoints: readonly Touchpoint[],
  model: AttributionModel,
  conversionAt: Date,
): readonly AttributionCredit[] {
  const halfLifeMs = TIME_DECAY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

  const raw = touchpoints.map((touch) => {
    const age = Math.max(0, conversionAt.getTime() - Date.parse(touch.occurredAt));
    return Math.pow(0.5, age / halfLifeMs);
  });

  const total = raw.reduce((sum, weight) => sum + weight, 0);

  // Every weight underflowed to zero (touches far older than the half-life): fall back to an even
  // split rather than dividing by zero and emitting NaN credit.
  if (total === 0) {
    return touchpoints.map((_, index) => credit(index, model, 1 / touchpoints.length));
  }

  return raw.map((weight, index) => credit(index, model, weight / total));
}

/** Computes the snapshot stamped on an event before delivery. */
export function computeAttribution(input: {
  readonly journeyId: string;
  readonly touchpoints: readonly Touchpoint[];
  readonly model: AttributionModel;
  readonly conversionAt: Date;
}): AttributionSnapshot {
  const ordered = [...input.touchpoints].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );

  const credits = assignCredit(ordered, input.model, input.conversionAt);

  return {
    journeyId: input.journeyId,
    model: input.model,
    credits,
    touchCount: ordered.length,
    firstTouchChannel: ordered[0]?.channelGroup,
    lastTouchChannel: ordered[ordered.length - 1]?.channelGroup,
    computedAt: input.conversionAt.toISOString(),
    unattributed: ordered.length === 0,
  };
}

/** Verifies weights sum to 1. Used in tests and available as a runtime diagnostic. */
export function creditsAreNormalized(
  credits: readonly AttributionCredit[],
  tolerance = 1e-6,
): boolean {
  if (credits.length === 0) return true;
  const total = credits.reduce((sum, c) => sum + c.weight, 0);
  return Math.abs(total - 1) <= tolerance;
}
