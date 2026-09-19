/** 1000 tokenCredits = $0.001 USD, i.e. one credit is a millionth of a dollar. */
const CREDITS_PER_USD = 1_000_000;

export function creditsToUsd(credits: number): number {
  return credits / CREDITS_PER_USD;
}

export function formatUsd(credits: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 6,
  }).format(creditsToUsd(credits));
}
