const RATE_PATTERN = /^(\d+\.?\d*|\.\d+)$/;

/** Parses a rate field; returns `null` unless it is a plain non-negative decimal. */
export function parseRate(value: string): number | null {
  const trimmed = value.trim();
  if (!RATE_PATTERN.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
