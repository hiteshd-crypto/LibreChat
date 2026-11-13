import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import DepartmentBalanceView from '../DepartmentBalanceView';

const mockUseMyDepartmentMembers = jest.fn();
const mockUseAdminUserBalance = jest.fn();

jest.mock('~/data-provider', () => ({
  useMyDepartmentMembers: () => mockUseMyDepartmentMembers(),
  useAdminUserBalance: (userId: string) => mockUseAdminUserBalance(userId),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en-US', language: 'en-US' } }),
}));

jest.mock('@librechat/client', () => ({
  Label: ({ children, variant: _v, ...props }: any) => <label {...props}>{children}</label>,
  Spinner: () => <span data-testid="spinner" />,
  ControlCombobox: ({ items, selectedValue, setValue, ariaLabel, selectPlaceholder }: any) => (
    <select aria-label={ariaLabel} value={selectedValue} onChange={(e) => setValue(e.target.value)}>
      <option value="">{selectPlaceholder}</option>
      {items.map((item: any) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));

const members = [
  { userId: 'head-1', name: 'A Gupta', email: 'a@x.io' },
  { userId: 'u2', name: 'O Negi', email: 'o@x.io' },
];

const membersLoaded = () =>
  mockUseMyDepartmentMembers.mockReturnValue({
    data: { members },
    isLoading: false,
    isError: false,
  });

const balanceLoaded = (tokenCredits: number, hasRecord = true) =>
  mockUseAdminUserBalance.mockReturnValue({
    data: { userId: 'head-1', tokenCredits, hasRecord },
    isLoading: false,
    isError: false,
  });

const pickMember = (id: string) =>
  userEvent.selectOptions(screen.getByLabelText('com_admin_balance_user_label'), id);

beforeEach(() => {
  jest.clearAllMocks();
  membersLoaded();
  balanceLoaded(5000);
});

describe('DepartmentBalanceView', () => {
  it("lists only the department's own members, including the head", () => {
    render(<DepartmentBalanceView />);
    expect(screen.getByRole('option', { name: 'A Gupta (a@x.io)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'O Negi (o@x.io)' })).toBeInTheDocument();
  });

  it('shows a read-only balance, with no edit control, once a member is selected', async () => {
    render(<DepartmentBalanceView />);
    await pickMember('head-1');
    expect(screen.getByText('₹0.50')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_ui_update' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_ui_save' })).not.toBeInTheDocument();
  });

  it('shows the empty state when the department has no members', () => {
    mockUseMyDepartmentMembers.mockReturnValue({
      data: { members: [] },
      isLoading: false,
      isError: false,
    });
    render(<DepartmentBalanceView />);
    expect(screen.getByRole('status')).toHaveTextContent('com_admin_balance_users_empty');
  });

  it('shows an error state when members fail to load', () => {
    mockUseMyDepartmentMembers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(<DepartmentBalanceView />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_admin_balance_users_error');
  });
});
