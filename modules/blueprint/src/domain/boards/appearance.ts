export function colorDepth(value: unknown): number {
  if (value === "deep") return 100;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
