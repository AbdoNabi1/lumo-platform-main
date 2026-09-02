/**
 * Generic immutable value object. Equality is structural (by value), and instances of
 * different concrete value-object types are never equal. Props are deeply frozen at construction
 * (plain objects and arrays, recursively) so composite value objects are truly immutable.
 */
export abstract class ValueObject<T> {
  protected readonly props: T;

  protected constructor(props: T) {
    deepFreeze(props);
    this.props = props;
  }

  equals(other?: ValueObject<T>): boolean {
    if (other === null || other === undefined) return false;
    if (this === other) return true;
    if (this.constructor !== other.constructor) return false;
    return deepEqual(this.props, other.props);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

/**
 * Recursively freezes plain objects and arrays so nested value-object props are immutable.
 * No cycle handling — value-object props are acyclic data. Primitives and `Date`s are left as-is.
 */
function deepFreeze(value: unknown): void {
  if (Array.isArray(value)) {
    for (const element of value) {
      deepFreeze(element);
    }
    Object.freeze(value);
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
}

/** Structural deep equality for value-object props (primitives, arrays, Dates, plain objects). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((element, index) => deepEqual(element, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
    );
  }
  return false;
}
