import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import TransferSection from '../TransferSection';

const mockPreviewMutate = jest.fn();
const mockConfirmMutate = jest.fn();

jest.mock('~/data-provider/Admin/mutations', () => ({
  useTransferPreview: () => ({ mutate: mockPreviewMutate, isLoading: false }),
  useTransferConfirm: () => ({ mutate: mockConfirmMutate, isLoading: false }),
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

const memberA = { userId: 'member-a', name: 'MemberA', email: 'a@example.com' };
const memberB = { userId: 'member-b', name: 'MemberB', email: 'b@example.com' };
const members = [memberA, memberB];

describe('TransferSection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('excludes the "From" selection from the "To" picker and vice versa', async () => {
    render(<TransferSection members={members} />);
    const [fromSelect, toSelect] = screen.getAllByRole('combobox');

    await userEvent.selectOptions(fromSelect, memberA.userId);
    // MemberA should no longer be selectable as "To"
    expect(
      Array.from(toSelect.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value),
    ).not.toContain(memberA.userId);

    await userEvent.selectOptions(toSelect, memberB.userId);
    expect(
      Array.from(fromSelect.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value),
    ).not.toContain(memberB.userId);
  });

  it('previews and confirms a valid transfer with the expected payload shape', async () => {
    mockPreviewMutate.mockImplementation((_body, { onSuccess }: any) =>
      onSuccess({
        from: { userId: memberA.userId, name: memberA.name, currentBalance: 10, newBalance: 5 },
        to: { userId: memberB.userId, name: memberB.name, currentBalance: 20, newBalance: 25 },
      }),
    );
    render(<TransferSection members={members} />);
    const [fromSelect, toSelect] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(fromSelect, memberA.userId);
    await userEvent.selectOptions(toSelect, memberB.userId);
    await userEvent.type(screen.getByRole('textbox'), '0.05');
    await userEvent.click(screen.getByText('com_admin_department_head_transfer_submit'));

    expect(mockPreviewMutate).toHaveBeenCalledWith(
      { fromUserId: memberA.userId, toUserId: memberB.userId, amount: 500 },
      expect.any(Object),
    );

    await userEvent.click(screen.getByText('com_admin_department_head_transfer_confirm_submit'));
    expect(mockConfirmMutate).toHaveBeenCalledWith(
      {
        fromUserId: memberA.userId,
        toUserId: memberB.userId,
        amount: 500,
        expectedFromBalance: 10,
        expectedToBalance: 20,
      },
      expect.any(Object),
    );
  });

  it('shows a success toast after a confirmed transfer', async () => {
    mockPreviewMutate.mockImplementation((_body, { onSuccess }: any) =>
      onSuccess({
        from: { userId: memberA.userId, name: memberA.name, currentBalance: 10, newBalance: 5 },
        to: { userId: memberB.userId, name: memberB.name, currentBalance: 20, newBalance: 25 },
      }),
    );
    mockConfirmMutate.mockImplementation((_body, { onSuccess }: any) => onSuccess());
    render(<TransferSection members={members} />);
    const [fromSelect, toSelect] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(fromSelect, memberA.userId);
    await userEvent.selectOptions(toSelect, memberB.userId);
    await userEvent.type(screen.getByRole('textbox'), '0.05');
    await userEvent.click(screen.getByText('com_admin_department_head_transfer_submit'));
    await userEvent.click(screen.getByText('com_admin_department_head_transfer_confirm_submit'));

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'com_admin_department_head_transfer_saved',
        severity: 'success',
      }),
    );
  });

  it('shows an error toast when confirming a transfer fails', async () => {
    mockPreviewMutate.mockImplementation((_body, { onSuccess }: any) =>
      onSuccess({
        from: { userId: memberA.userId, name: memberA.name, currentBalance: 10, newBalance: 5 },
        to: { userId: memberB.userId, name: memberB.name, currentBalance: 20, newBalance: 25 },
      }),
    );
    mockConfirmMutate.mockImplementation((_body, { onError }: any) => onError(new Error('boom')));
    render(<TransferSection members={members} />);
    const [fromSelect, toSelect] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(fromSelect, memberA.userId);
    await userEvent.selectOptions(toSelect, memberB.userId);
    await userEvent.type(screen.getByRole('textbox'), '0.05');
    await userEvent.click(screen.getByText('com_admin_department_head_transfer_submit'));
    await userEvent.click(screen.getByText('com_admin_department_head_transfer_confirm_submit'));

    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
