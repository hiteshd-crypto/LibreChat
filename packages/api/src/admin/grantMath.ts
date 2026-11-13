export function isPositiveAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

/**
 * Evenly splits `total` across `n` participants, rounded to 6 decimal places (matching the
 * existing balance-display precision), and applies that identical rounded value to every
 * participant. By design, `perParticipantAmount * n` need not exactly equal `total` — there is
 * no remainder assigned to anyone; this is the approved policy, not a bug to "fix" later.
 */
export function computeEvenAllocation(total: number, n: number): number {
  const raw = total / n;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

export function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
