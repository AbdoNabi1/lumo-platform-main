/** Value serialization for cache storage. */
export interface Serializer {
  serialize<T>(value: T): string;
  deserialize<T>(raw: string): T;
}

/** Default JSON serializer. */
export const jsonSerializer: Serializer = {
  serialize<T>(value: T): string {
    return JSON.stringify(value);
  },
  deserialize<T>(raw: string): T {
    return JSON.parse(raw) as T;
  },
};
