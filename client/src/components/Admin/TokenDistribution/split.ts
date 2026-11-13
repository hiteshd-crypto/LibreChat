/**
 * Evenly splits `total` across `n` participants, rounded to 6 decimal places, applied
 * identically to every participant — no remainder goes to anyone. Mirrors
 * `computeEvenAllocation` in `packages/api/src/admin/tokenDistribution.ts` exactly, so this
 * client-side preview estimate matches what the server will actually compute (the server always
 * recomputes this itself on both preview and confirm — this is a cosmetic live-estimate only).
 */
export function computeEvenAllocation(total: number, n: number): number {
  const raw = total / n;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
