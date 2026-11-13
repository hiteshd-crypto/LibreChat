import { render, screen } from '@testing-library/react';
import TokenCreditsItem from '../TokenCreditsItem';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));

describe('TokenCreditsItem', () => {
  it('shows the balance converted to INR', () => {
    render(<TokenCreditsItem tokenCredits={5_000_000} />);
    expect(screen.getByText('₹500.00')).toBeInTheDocument();
  });

  it('shows ₹0.00 when tokenCredits is undefined', () => {
    render(<TokenCreditsItem />);
    expect(screen.getByText('₹0.00')).toBeInTheDocument();
  });
});
