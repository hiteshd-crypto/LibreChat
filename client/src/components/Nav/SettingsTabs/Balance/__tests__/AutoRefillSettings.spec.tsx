import { render, screen } from '@testing-library/react';
import AutoRefillSettings from '../AutoRefillSettings';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
  useClockFormat: () => true,
}));

describe('AutoRefillSettings', () => {
  it('shows the refill amount converted to INR', () => {
    render(
      <AutoRefillSettings
        lastRefill={new Date('2026-01-01T00:00:00Z').toISOString()}
        refillAmount={10_000}
        refillIntervalUnit="days"
        refillIntervalValue={1}
      />,
    );
    expect(screen.getByText('₹1.00')).toBeInTheDocument();
  });
});
