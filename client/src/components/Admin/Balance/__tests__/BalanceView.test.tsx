import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import BalanceView from '../BalanceView';

const mockUseAdminAllUsers = jest.fn();
const mockUseAdminUserBalance = jest.fn();
const mockSetBalance = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/data-provider', () => ({
  useAdminAllUsers: () => mockUseAdminAllUsers(),
  useAdminUserBalance: (userId: string) => mockUseAdminUserBalance(userId),
  useSetUserBalance: () => ({ mutate: mockSetBalance, isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en-US', language: 'en-US' } }),
}));

jest.mock('~/common', () => ({
  NotificationSeverity: { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' },
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, variant: _v, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
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
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const users = [
  { id: 'u1', name: 'Ann Lee', email: 'ann@x.io' },
  { id: 'u2', name: '', email: 'bob@x.io' },
];

const usersLoaded = (overrides: Record<string, unknown> = {}) =>
  mockUseAdminAllUsers.mockReturnValue({
    data: { users, total: users.length, truncated: false, ...overrides },
    isLoading: false,
    isError: false,
  });

const balanceLoaded = (tokenCredits: number, hasRecord = true) =>
  mockUseAdminUserBalance.mockReturnValue({
    data: { userId: 'u1', tokenCredits, hasRecord },
    isLoading: false,
    isError: false,
  });

const pickUser = (id: string) =>
  userEvent.selectOptions(screen.getByLabelText('com_admin_balance_user_label'), id);

beforeEach(() => {
  jest.clearAllMocks();
  usersLoaded();
  balanceLoaded(5000);
});

describe('BalanceView', () => {
  it('shows a spinner while users load', () => {
    mockUseAdminAllUsers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<BalanceView />);
    expect(screen.getByTestId('admin-balance-users-loading')).toBeInTheDocument();
  });

  it('shows an error when users fail to load', () => {
    mockUseAdminAllUsers.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<BalanceView />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_admin_balance_users_error');
  });

  it('shows the empty state when there are no users', () => {
    usersLoaded({ users: [], total: 0 });
    render(<BalanceView />);
    expect(screen.getByRole('status')).toHaveTextContent('com_admin_balance_users_empty');
  });

  it('prompts for a selection and fetches no balance until one is made', () => {
    render(<BalanceView />);
    expect(screen.getByText('com_admin_balance_select_prompt')).toBeInTheDocument();
    expect(screen.queryByLabelText('com_admin_balance_label')).not.toBeInTheDocument();
    expect(mockUseAdminUserBalance).not.toHaveBeenCalled();
  });

  it('labels users by name and email, falling back to email alone', () => {
    render(<BalanceView />);
    expect(screen.getByRole('option', { name: 'Ann Lee (ann@x.io)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'bob@x.io' })).toBeInTheDocument();
  });

  it('says so when the user list was truncated', () => {
    usersLoaded({ truncated: true, total: 9000 });
    render(<BalanceView />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'com_admin_balance_users_truncated:2,9000',
    );
  });

  describe('with a user selected', () => {
    it('shows the balance read-only with its USD equivalent', async () => {
      render(<BalanceView />);
      await pickUser('u1');
      const field = screen.getByLabelText('com_admin_balance_label');
      expect(field).toHaveValue('5000');
      expect(field).toHaveAttribute('readonly');
      expect(screen.getByText('com_admin_balance_usd:$0.005')).toBeInTheDocument();
    });

    it('shows a spinner while the balance loads', async () => {
      mockUseAdminUserBalance.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<BalanceView />);
      await pickUser('u1');
      expect(screen.getByTestId('admin-balance-loading')).toBeInTheDocument();
    });

    it('shows an error when the balance fails to load', async () => {
      mockUseAdminUserBalance.mockReturnValue({ data: undefined, isLoading: false, isError: true });
      render(<BalanceView />);
      await pickUser('u1');
      expect(screen.getByRole('alert')).toHaveTextContent('com_admin_balance_load_error');
    });

    it('notes that saving will create a record when none exists', async () => {
      balanceLoaded(0, false);
      render(<BalanceView />);
      await pickUser('u1');
      expect(screen.getByRole('status')).toHaveTextContent('com_admin_balance_no_record');
    });

    it('makes the field editable on Update and saves a valid value', async () => {
      render(<BalanceView />);
      await pickUser('u1');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_update' }));
      const field = screen.getByLabelText('com_admin_balance_label');
      expect(field).not.toHaveAttribute('readonly');

      await userEvent.clear(field);
      await userEvent.type(field, '7500.5');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
      expect(mockSetBalance).toHaveBeenCalledWith(
        { userId: 'u1', tokenCredits: 7500.5 },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      );
    });

    it.each(['-5', 'abc', '', '1e3'])('rejects %p inline without saving', async (input) => {
      render(<BalanceView />);
      await pickUser('u1');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_update' }));
      const field = screen.getByLabelText('com_admin_balance_label');
      await userEvent.clear(field);
      if (input) {
        await userEvent.type(field, input);
      }
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
      expect(screen.getByRole('alert')).toHaveTextContent('com_admin_balance_invalid');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(mockSetBalance).not.toHaveBeenCalled();
    });

    it('restores the stored value on cancel', async () => {
      render(<BalanceView />);
      await pickUser('u1');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_update' }));
      const field = screen.getByLabelText('com_admin_balance_label');
      await userEvent.clear(field);
      await userEvent.type(field, '1');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
      expect(screen.getByLabelText('com_admin_balance_label')).toHaveValue('5000');
      expect(mockSetBalance).not.toHaveBeenCalled();
    });

    it('leaves edit mode when another user is selected', async () => {
      render(<BalanceView />);
      await pickUser('u1');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_update' }));
      await pickUser('u2');
      expect(screen.getByLabelText('com_admin_balance_label')).toHaveAttribute('readonly');
    });
  });
});
