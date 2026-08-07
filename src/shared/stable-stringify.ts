import stringify from "fast-json-stable-stringify";

/** Deterministic (sorted-key) JSON serialization, for content digests. */
export function stableStringify(value: unknown): string {
  return stringify(value);
}
