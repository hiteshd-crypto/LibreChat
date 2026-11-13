/** 100 ₹ = 1,000,000 tokenCredits, i.e. one credit is 1/10,000 of a rupee. */
const CREDITS_PER_INR = 10_000;

export function creditsToInr(credits: number): number {
  return credits / CREDITS_PER_INR;
}

export function inrToCredits(inr: number): number {
  return inr * CREDITS_PER_INR;
}

/** Formats an amount already in INR (not credits) as currency, rounded to
 *  `maximumFractionDigits` (2 by default, matching standard currency display). */
export function formatInr(inr: number, locale?: string, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits,
  }).format(inr);
}
