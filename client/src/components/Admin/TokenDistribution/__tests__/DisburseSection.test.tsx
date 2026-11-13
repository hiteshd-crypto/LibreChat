import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import DisburseSection from '../DisburseSection';

const mockPreviewMutate = jest.fn();
const mockConfirmMutate = jest.fn();
const mockGetPoolConflictError = jest.fn().mockReturnValue(null);

jest.mock('~/data-provider/Admin/mutations', () => ({
  useDisbursePreview: () => ({ mutate: mockPreviewMutate, isLoading: false }),
  useDisburseConfirm: () => ({ mutate: mockConfirmMutate, isLoading: false }),
  getPoolConflictError: (...args: unknown[]) => mockGetPoolConflictError(...args),
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

const mockShowToast = jest.fn();

jest.mock('@librechat/client', () => ({
  Button: ({ children, variant: _v, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
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

const head = { userId: 'head-1', name: 'Head', email: 'head@example.com' };
const memberA = { userId: 'member-a', name: 'MemberA', email: 'a@example.com' };
const memberB = { userId: 'member-b', name: 'MemberB', email: 'b@example.com' };
const members = [head, memberA, memberB];

describe('DisburseSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPoolConflictError.mockReturnValue(null);
  });

  it('allows the Department Head to select themself as a recipient — no root exclusion', () => {
    render(<DisburseSection members={members} poolBalance={1000} />);
    expect(screen.getByText('Head (head@example.com)')).toBeInTheDocument();
  });

  it('previews an even split and confirms with the preview payload shape', async () => {
    mockPreviewMutate.mockImplementation((_body, { onSuccess }: any) =>
      onSuccess({
        poolBalance: 1000,
        perRecipientAmount: 50,
        rows: [
          { userId: memberA.userId, name: memberA.name, currentBalance: 10, newBalance: 60 },
          { userId: memberB.userId, name: memberB.name, currentBalance: 20, newBalance: 70 },
        ],
      }),
    );
    render(<DisburseSection members={members} poolBalance={1000} />);

    const [firstRecipient] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(firstRecipient, memberA.userId);
    await userEvent.click(screen.getByText('com_admin_token_grant_add_recipient'));
    const comboboxes = screen.getAllByRole('combobox');
    await userEvent.selectOptions(comboboxes[1], memberB.userId);

    await userEvent.type(screen.getByRole('textbox'), '1');
    await userEvent.click(screen.getByText('com_admin_department_head_disburse_submit'));

    expect(mockPreviewMutate).toHaveBeenCalledWith(
      { recipientUserIds: [memberA.userId, memberB.userId], totalAmount: 10000 },
      expect.any(Object),
    );

    await userEvent.click(screen.getByText('com_admin_department_head_disburse_confirm_submit'));
    expect(mockConfirmMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: [memberA.userId, memberB.userId],
        totalAmount: 10000,
        expectedPoolBalance: 1000,
        expectedBalances: { [memberA.userId]: 10, [memberB.userId]: 20 },
      }),
      expect.any(Object),
    );
  });

  it('shows a success toast and resets the form after a confirmed disbursement', async () => {
    mockPreviewMutate.mockImplementation((_body, { onSuccess }: any) =>
      onSuccess({
        poolBalance: 1000,
        perRecipientAmount: 100,
        rows: [{ userId: memberA.userId, name: memberA.name, currentBalance: 10, newBalance: 110 }],
      }),
    );
    mockConfirmMutate.mockImplementation((_body, { onSuccess }: any) => onSuccess());
    render(<DisburseSection members={members} poolBalance={1000} />);

    const [firstRecipient] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(firstRecipient, memberA.userId);
    await userEvent.type(screen.getByRole('textbox'), '1');
    await userEvent.click(screen.getByText('com_admin_department_head_disburse_submit'));
    await userEvent.click(screen.getByText('com_admin_department_head_disburse_confirm_submit'));

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'com_admin_department_head_disburse_saved',
        severity: 'success',
      }),
    );
  });

  it('shows both an inline message and a toast when the pool is insufficient at confirm time', async () => {
    mockPreviewMutate.mockImplementation((_body, { onSuccess }: any) =>
      onSuccess({
        poolBalance: 1000,
        perRecipientAmount: 100,
        rows: [{ userId: memberA.userId, name: memberA.name, currentBalance: 10, newBalance: 110 }],
      }),
    );
    mockConfirmMutate.mockImplementation((_body, { onError }: any) =>
      onError(new Error('insufficient')),
    );
    mockGetPoolConflictError.mockReturnValue({ requested: 2000 });
    render(<DisburseSection members={members} poolBalance={1000} />);

    const [firstRecipient] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(firstRecipient, memberA.userId);
    await userEvent.type(screen.getByRole('textbox'), '1');
    await userEvent.click(screen.getByText('com_admin_department_head_disburse_submit'));
    await userEvent.click(screen.getByText('com_admin_department_head_disburse_confirm_submit'));

    expect(
      screen.getByText('com_admin_department_head_disburse_pool_insufficient_error'),
    ).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'com_admin_department_head_disburse_pool_insufficient_error',
        severity: 'error',
      }),
    );
  });

  it('a member not selected in any recipient row receives nothing in the preview rows', async () => {
    mockPreviewMutate.mockImplementation((_body, { onSuccess }: any) =>
      onSuccess({
        poolBalance: 1000,
        perRecipientAmount: 100,
        rows: [{ userId: memberA.userId, name: memberA.name, currentBalance: 10, newBalance: 110 }],
      }),
    );
    render(<DisburseSection members={members} poolBalance={1000} />);

    const [firstRecipient] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(firstRecipient, memberA.userId);
    await userEvent.type(screen.getByRole('textbox'), '1');
    await userEvent.click(screen.getByText('com_admin_department_head_disburse_submit'));

    expect(screen.queryByText(memberB.name)).not.toBeInTheDocument();
  });
});
