import { render, screen } from '@testing-library/react';
import DepartmentHeadBalanceView from '../DepartmentHeadBalanceView';
import { creditsToInr, formatInr } from '~/utils';

const mockBalance = jest.fn();
const mockMembers = jest.fn();

jest.mock('~/data-provider', () => ({
  useDepartmentBalance: (...args: unknown[]) => mockBalance(...args),
  useMyDepartmentMembers: (...args: unknown[]) => mockMembers(...args),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en-US', language: 'en-US' } }),
}));

jest.mock('../DisburseSection', () => ({
  __esModule: true,
  default: ({ members, poolBalance }: any) => (
    <div
      data-testid="disburse-section"
      data-member-count={members.length}
      data-pool={poolBalance}
    />
  ),
}));

jest.mock('../TransferSection', () => ({
  __esModule: true,
  default: ({ members }: any) => (
    <div data-testid="transfer-section" data-member-count={members.length} />
  ),
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <span data-testid="spinner" />,
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

const departmentHead = {
  departmentId: 'dept-1',
  departmentName: 'Finance',
  rootRoleKey: 'FIN_HEAD',
};

describe('DepartmentHeadBalanceView', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the pool balance and the derived available balance (total - pool), and passes members/poolBalance down to both tabs', () => {
    mockBalance.mockReturnValue({
      data: { poolBalance: 1000, totalBalance: 1500 },
      isLoading: false,
      isError: false,
    });
    mockMembers.mockReturnValue({
      data: { members: [{ userId: 'u1', name: 'A', email: 'a@x.com' }] },
      isLoading: false,
      isError: false,
    });

    render(<DepartmentHeadBalanceView departmentHead={departmentHead} />);

    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText(formatInr(creditsToInr(1000), 'en-US'))).toBeInTheDocument();
    // available = totalBalance(1500) - poolBalance(1000) = 500, not the combined 1500.
    expect(screen.getByText(formatInr(creditsToInr(500), 'en-US'))).toBeInTheDocument();
    expect(screen.queryByText(formatInr(creditsToInr(1500), 'en-US'))).not.toBeInTheDocument();
    expect(screen.getByTestId('disburse-section')).toHaveAttribute('data-member-count', '1');
    expect(screen.getByTestId('disburse-section')).toHaveAttribute('data-pool', '1000');
    expect(screen.getByTestId('transfer-section')).toHaveAttribute('data-member-count', '1');
  });

  it('keeps Available Balance unchanged when a fresh grant lands in the pool', () => {
    // Scenario from the product spec: usage drained Available to 550 (pool 0), then the Super
    // Admin grants 200 more into the pool. Available must stay at 550 until actually disbursed.
    mockBalance.mockReturnValue({
      data: { poolBalance: 200, totalBalance: 750 },
      isLoading: false,
      isError: false,
    });
    mockMembers.mockReturnValue({
      data: { members: [{ userId: 'u1', name: 'A', email: 'a@x.com' }] },
      isLoading: false,
      isError: false,
    });

    render(<DepartmentHeadBalanceView departmentHead={departmentHead} />);

    expect(screen.getByText(formatInr(creditsToInr(200), 'en-US'))).toBeInTheDocument();
    expect(screen.getByText(formatInr(creditsToInr(550), 'en-US'))).toBeInTheDocument();
    expect(screen.queryByText(formatInr(creditsToInr(750), 'en-US'))).not.toBeInTheDocument();
  });

  it('shows a spinner while loading', () => {
    mockBalance.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockMembers.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    render(<DepartmentHeadBalanceView departmentHead={departmentHead} />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('shows a load error when either query fails', () => {
    mockBalance.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockMembers.mockReturnValue({ data: { members: [] }, isLoading: false, isError: false });

    render(<DepartmentHeadBalanceView departmentHead={departmentHead} />);
    expect(screen.getByText('com_admin_access_load_error')).toBeInTheDocument();
  });
});
