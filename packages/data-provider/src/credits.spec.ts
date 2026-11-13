import { creditsToInr, inrToCredits, formatInr } from './credits';

describe('credits', () => {
  it('converts 1000 credits to ₹0.1', () => {
    expect(creditsToInr(1000)).toBeCloseTo(0.1, 10);
    expect(creditsToInr(0)).toBe(0);
  });

  it('converts an INR amount back to credits', () => {
    expect(inrToCredits(0.1)).toBeCloseTo(1000, 10);
    expect(inrToCredits(0)).toBe(0);
  });

  it('formats to exactly 2 decimal places by default', () => {
    expect(formatInr(0.1, 'en-US')).toBe('₹0.10');
    expect(formatInr(0.0001, 'en-US')).toBe('₹0.00');
    expect(formatInr(5, 'en-US')).toBe('₹5.00');
    expect(formatInr(0, 'en-US')).toBe('₹0.00');
    expect(formatInr(1.567, 'en-US')).toBe('₹1.57');
  });

  it('allows more precision via maximumFractionDigits (used by the admin editor)', () => {
    expect(formatInr(0.0001, 'en-US', 6)).toBe('₹0.0001');
    expect(formatInr(0.1, 'en-US', 6)).toBe('₹0.10');
  });

  it('formats without an explicit locale using the runtime default', () => {
    expect(formatInr(5)).toBe(formatInr(5, undefined));
  });

  it('uses Indian digit grouping (lakhs) for en-IN', () => {
    expect(formatInr(1_000_000, 'en-IN')).toBe('₹10,00,000.00');
  });
});
