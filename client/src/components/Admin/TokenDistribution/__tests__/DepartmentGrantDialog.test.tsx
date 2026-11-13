import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import DepartmentGrantDialog from '../DepartmentGrantDialog';
import { creditsToInr, formatInr } from '~/utils';

const mockBalance = jest.fn();
const mockGrantMutate = jest.fn();

jest.mock('~/data-provider', () => ({
  useDepartmentBalance: (...args: unknown[]) => mockBalance(...args),
}));

jest.mock('~/data-provider/Admin/mutations', () => ({
  useGrantDepartmentBalance: () => ({ mutate: mockGrantMutate, isLoading: false }),
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
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
  Spinner: () => <span data-testid="spinner" />,
  OGDialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  OGDialogTemplate: ({ title, main, buttons }: any) => (
    <div>
      <h2>{title}</h2>
      {main}
      {buttons}
    </div>
  ),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

const department = { _id: 'dept-1', name: 'Finance', rootRoleKey: 'FIN_HEAD' };

describe('DepartmentGrantDialog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the total department balance (pool + members) in INR', () => {
    mockBalance.mockReturnValue({
      data: { poolBalance: 50000000, totalBalance: 150000000 },
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<DepartmentGrantDialog department={department as any} onClose={jest.fn()} />);

    expect(screen.getByText(formatInr(creditsToInr(150000000), 'en-US'))).toBeInTheDocument();
  });

  it("titles the dialog with the department's own name, not a generic label", () => {
    mockBalance.mockReturnValue({
      data: { poolBalance: 0, totalBalance: 0 },
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<DepartmentGrantDialog department={department as any} onClose={jest.fn()} />);

    expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.queryByText('com_admin_department_grant_title')).not.toBeInTheDocument();
  });

  it('shows the generic load error on failure', () => {
    mockBalance.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { isAxiosError: true, response: { status: 500 } },
    });
    render(<DepartmentGrantDialog department={department as any} onClose={jest.fn()} />);

    expect(screen.getByText('com_admin_access_load_error')).toBeInTheDocument();
  });

  it('shows the no-head guard, with the amount input disabled, for a department with no head yet', () => {
    mockBalance.mockReturnValue({
      data: { poolBalance: 0, totalBalance: 0 },
      isLoading: false,
      isError: false,
      error: null,
    });
    render(
      <DepartmentGrantDialog
        department={{ ...department, rootRoleKey: null } as any}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('com_admin_department_no_head')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('submits a single-step grant with the entered amount converted to credits — no preview table', async () => {
    mockBalance.mockReturnValue({
      data: { poolBalance: 0, totalBalance: 0 },
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<DepartmentGrantDialog department={department as any} onClose={jest.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), '5');
    await userEvent.click(screen.getByText('com_admin_token_grant_submit'));

    expect(mockGrantMutate).toHaveBeenCalledWith(
      { departmentId: 'dept-1', body: { amount: 50000 } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
