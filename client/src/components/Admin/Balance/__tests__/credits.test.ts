import { creditsToUsd, formatUsd } from '../credits';

describe('credits', () => {
  it('converts 1000 credits to $0.001', () => {
    expect(creditsToUsd(1000)).toBeCloseTo(0.001, 10);
    expect(creditsToUsd(0)).toBe(0);
  });

  it('formats as USD with sub-cent precision', () => {
    expect(formatUsd(1000, 'en-US')).toBe('$0.001');
    expect(formatUsd(5_000_000, 'en-US')).toBe('$5.00');
    expect(formatUsd(0, 'en-US')).toBe('$0.00');
  });
});
