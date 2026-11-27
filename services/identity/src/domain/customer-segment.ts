import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError, type FieldIssue } from "@platform/utils";
import { normalizeTag, tagKeyOf } from "./customer-annotations";

export type SegmentCmp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
export type SegmentCondition =
  | { readonly field: "orders_count"; readonly op: SegmentCmp; readonly value: number }
  | { readonly field: "amount_spent"; readonly op: SegmentCmp; readonly valueMinor: number }
  | {
      readonly field: "last_order_date";
      readonly op: "within_last_days" | "not_within_last_days";
      readonly days: number;
    }
  | {
      readonly field: "last_order_date";
      readonly op: "on_or_after" | "before";
      readonly date: string;
    }
  | { readonly field: "last_order_date"; readonly op: "never" }
  | { readonly field: "email_subscribed"; readonly value: boolean }
  | { readonly field: "sms_subscribed"; readonly value: boolean }
  | {
      readonly field: "tags";
      readonly op: "has_any" | "has_all" | "has_none";
      readonly values: readonly string[];
    }
  | { readonly field: "country"; readonly op: "in" | "not_in"; readonly values: readonly string[] }
  | {
      readonly field: "created_date";
      readonly op: "within_last_days" | "not_within_last_days";
      readonly days: number;
    }
  | { readonly field: "created_date"; readonly op: "on_or_after" | "before"; readonly date: string }
  | { readonly field: "language"; readonly op: "eq" | "neq"; readonly value: "en" | "ar" }
  | { readonly field: "language"; readonly op: "unset" };

export const MAX_SEGMENT_CONDITIONS = 10;
export const MAX_SEGMENT_NAME_LENGTH = 100;
export const MAX_CUSTOM_SEGMENTS = 100;
export function segmentNameKey(name: string): string {
  return normalizeTag(name).toLowerCase();
}
export interface DefaultSegment {
  readonly id: `default:${string}`;
  readonly key: string;
  readonly conditions: readonly SegmentCondition[];
}
export const DEFAULT_SEGMENTS: readonly DefaultSegment[] = [
  {
    id: "default:purchased_at_least_once",
    key: "purchasedAtLeastOnce",
    conditions: [{ field: "orders_count", op: "gte", value: 1 }],
  },
  {
    id: "default:email_subscribers",
    key: "emailSubscribers",
    conditions: [{ field: "email_subscribed", value: true }],
  },
  {
    id: "default:purchased_more_than_once",
    key: "purchasedMoreThanOnce",
    conditions: [{ field: "orders_count", op: "gt", value: 1 }],
  },
  {
    id: "default:not_purchased",
    key: "notPurchased",
    conditions: [{ field: "orders_count", op: "eq", value: 0 }],
  },
];
export function isDefaultSegmentId(id: string): boolean {
  return id.startsWith("default:");
}

function realDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function parseSegmentConditions(
  raw: unknown,
): Result<readonly SegmentCondition[], ValidationError> {
  const issues: FieldIssue[] = [];
  const parsed: SegmentCondition[] = [];
  const issue = (field: string): void => {
    issues.push({ field, message: "Invalid value" });
  };
  if (!Array.isArray(raw))
    return err(
      new ValidationError("Invalid segment", [
        { field: "conditions", message: "Must be an array" },
      ]),
    );
  if (raw.length < 1 || raw.length > MAX_SEGMENT_CONDITIONS) issue("conditions");
  raw.forEach((entry: unknown, i: number) => {
    const path = `conditions.${i}`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      issue(path);
      return;
    }
    const c = entry as Record<string, unknown>;
    const start = issues.length;
    const op = (allowed: readonly string[]): void => {
      if (typeof c.op !== "string" || !allowed.includes(c.op)) issue(`${path}.op`);
    };
    const integer = (key: string, min: number, max: number): void => {
      const n = c[key];
      if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
        issue(`${path}.${key}`);
    };
    let result: Record<string, unknown> = { field: c.field };
    switch (c.field) {
      case "orders_count":
      case "amount_spent": {
        const key = c.field === "orders_count" ? "value" : "valueMinor";
        op(["eq", "neq", "gt", "gte", "lt", "lte"]);
        integer(key, 0, c.field === "orders_count" ? 1_000_000 : 1_000_000_000_000);
        result = { field: c.field, op: c.op, [key]: c[key] };
        break;
      }
      case "last_order_date":
      case "created_date": {
        op([
          "within_last_days",
          "not_within_last_days",
          "on_or_after",
          "before",
          ...(c.field === "last_order_date" ? ["never"] : []),
        ]);
        result = { field: c.field, op: c.op };
        if (c.op === "within_last_days" || c.op === "not_within_last_days") {
          integer("days", 1, 3650);
          result.days = c.days;
        }
        if (c.op === "on_or_after" || c.op === "before") {
          if (!realDate(c.date)) issue(`${path}.date`);
          result.date = c.date;
        }
        break;
      }
      case "email_subscribed":
      case "sms_subscribed":
        if (typeof c.value !== "boolean") issue(`${path}.value`);
        result.value = c.value;
        break;
      case "tags":
      case "country": {
        op(c.field === "tags" ? ["has_any", "has_all", "has_none"] : ["in", "not_in"]);
        const values = new Map<string, string>();
        let invalid = !Array.isArray(c.values);
        if (Array.isArray(c.values))
          for (const value of c.values as unknown[]) {
            if (typeof value !== "string") {
              invalid = true;
              continue;
            }
            const normalized =
              c.field === "tags" ? normalizeTag(value) : value.trim().toUpperCase();
            if (
              c.field === "tags"
                ? !normalized || [...normalized].length > 40
                : !/^[A-Z]{2}$/.test(normalized)
            ) {
              invalid = true;
              continue;
            }
            const key = c.field === "tags" ? tagKeyOf(normalized) : normalized;
            if (!values.has(key)) values.set(key, normalized);
          }
        if (invalid || values.size < 1 || values.size > 20) issue(`${path}.values`);
        result = { field: c.field, op: c.op, values: [...values.values()] };
        break;
      }
      case "language":
        op(["eq", "neq", "unset"]);
        result.op = c.op;
        if (c.op === "eq" || c.op === "neq") {
          if (c.value !== "en" && c.value !== "ar") issue(`${path}.value`);
          result.value = c.value;
        }
        break;
      default:
        issue(`${path}.field`);
    }
    if (issues.length === start) parsed.push(result as SegmentCondition);
  });
  return issues.length ? err(new ValidationError("Invalid segment", issues)) : ok(parsed);
}

interface CustomerSegmentProps {
  name: string;
  nameKey: string;
  conditions: readonly SegmentCondition[];
  readonly createdBy: string | null;
  readonly createdAt: Date;
  updatedAt: Date;
}
export class CustomerSegment extends AggregateRoot<CustomerSegmentProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    conditions: readonly SegmentCondition[],
    createdBy: string | null,
    now: Date,
  ): CustomerSegment {
    return new CustomerSegment(
      {
        name,
        nameKey: segmentNameKey(name),
        conditions,
        createdBy,
        createdAt: now,
        updatedAt: now,
      },
      id,
    );
  }
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    conditions: readonly SegmentCondition[],
    version: number,
    createdBy: string | null,
    createdAt: Date,
    updatedAt: Date,
  ): CustomerSegment {
    return new CustomerSegment(
      { name, nameKey: segmentNameKey(name), conditions, createdBy, createdAt, updatedAt },
      id,
      version,
    );
  }
  rename(name: string, now: Date): void {
    this.props.name = name;
    this.props.nameKey = segmentNameKey(name);
    this.props.updatedAt = now;
  }
  replaceConditions(conditions: readonly SegmentCondition[], now: Date): void {
    this.props.conditions = conditions;
    this.props.updatedAt = now;
  }
  get name(): string {
    return this.props.name;
  }
  get nameKey(): string {
    return this.props.nameKey;
  }
  get conditions(): readonly SegmentCondition[] {
    return this.props.conditions;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
