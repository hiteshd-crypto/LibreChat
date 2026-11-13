import { render, screen, fireEvent } from '@testing-library/react';
import AuditLogView from '../AuditLogView';

const mockUseAdminAuditLog = jest.fn();
const mockUseVerifyAdminAuditLog = jest.fn();
const mockUseDepartments = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en', language: 'en' } }),
}));

jest.mock('~/data-provider', () => ({
  useAdminAuditLog: (...args: unknown[]) => mockUseAdminAuditLog(...args),
  useVerifyAdminAuditLog: () => mockUseVerifyAdminAuditLog(),
  useDepartments: () => mockUseDepartments(),
  AUDIT_LOG_PAGE_SIZE: 25,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: { exportAdminAuditLogCsv: jest.fn() },
}));

jest.mock('@librechat/client', () => ({
  Button: (props: any) => <button {...props} />,
  Spinner: () => <span data-testid="spinner" />,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/components/ui', () => ({
  LocalizedDateRangePicker: ({ onSelectDateRange }: any) => (
    <button
      type="button"
      data-testid="pick-date-range"
      onClick={() => onSelectDateRange(new Date(2026, 0, 1), new Date(2026, 0, 31))}
    />
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseVerifyAdminAuditLog.mockReturnValue({ mutate: jest.fn(), isLoading: false });
  mockUseDepartments.mockReturnValue({
    data: { departments: [{ _id: 'd1', name: 'Finance', rootRoleKey: 'FIN' }] },
  });
});

describe('AuditLogView', () => {
  it('shows a spinner while loading', () => {
    mockUseAdminAuditLog.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<AuditLogView />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('shows an error message on failure', () => {
    mockUseAdminAuditLog.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<AuditLogView />);
    expect(screen.getByText('com_admin_audit_log_load_error')).toBeInTheDocument();
  });

  it('shows an empty state with no entries', () => {
    mockUseAdminAuditLog.mockReturnValue({
      data: { entries: [], total: 0, nextCursor: null },
      isLoading: false,
      isError: false,
    });
    render(<AuditLogView />);
    expect(screen.getByText('com_admin_audit_log_empty')).toBeInTheDocument();
  });

  it('renders rows for returned entries', () => {
    mockUseAdminAuditLog.mockReturnValue({
      data: {
        entries: [
          {
            id: 'e1',
            action: 'balance.token_grant',
            outcome: 'success',
            actor: { type: 'user', id: 'u1', name: 'Admin' },
            target: { type: 'department', id: 'd1', name: 'Finance' },
            metadata: { kind: 'department_pool_grant', amount: 100 },
            integrity: { seq: 1, hash: 'h', prevHash: 'p' },
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
    });
    render(<AuditLogView />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getAllByText('Finance').length).toBeGreaterThan(0);
  });

  it('does not refetch on filter changes until View Logs is clicked', () => {
    mockUseAdminAuditLog.mockReturnValue({
      data: { entries: [], total: 0, nextCursor: null },
      isLoading: false,
      isError: false,
    });
    render(<AuditLogView />);

    expect(mockUseAdminAuditLog).toHaveBeenLastCalledWith(1, {});

    const departmentSelect = screen.getByDisplayValue('com_admin_audit_log_filter_department_all');
    fireEvent.change(departmentSelect, { target: { value: 'Finance' } });
    fireEvent.click(screen.getByTestId('pick-date-range'));
    expect(mockUseAdminAuditLog).toHaveBeenLastCalledWith(1, {});

    fireEvent.click(screen.getByText('com_admin_audit_log_view_logs'));
    expect(mockUseAdminAuditLog).toHaveBeenLastCalledWith(1, {
      targetType: 'department',
      targetQuery: 'Finance',
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('hides metadata for capability grant/revoke rows but keeps it for other actions', () => {
    mockUseAdminAuditLog.mockReturnValue({
      data: {
        entries: [
          {
            id: 'e1',
            action: 'grant.assigned',
            outcome: 'success',
            actor: { type: 'user', id: 'u1', name: 'Admin' },
            target: { type: 'role', id: 'r1', name: 'Marketing' },
            metadata: { capability: 'manage:department' },
            integrity: { seq: 1, hash: 'h', prevHash: 'p' },
            timestamp: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'e2',
            action: 'balance.token_grant',
            outcome: 'success',
            actor: { type: 'user', id: 'u1', name: 'Admin' },
            target: { type: 'department', id: 'd1', name: 'Finance' },
            metadata: { kind: 'department_pool_grant', amount: 100 },
            integrity: { seq: 2, hash: 'h2', prevHash: 'h' },
            timestamp: '2026-01-02T00:00:00.000Z',
          },
        ],
        total: 2,
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
    });
    render(<AuditLogView />);

    expect(screen.getByText('com_admin_audit_log_details_hidden')).toBeInTheDocument();
    expect(screen.queryByText('{"capability":"manage:department"}')).not.toBeInTheDocument();
    expect(
      screen.getByText('{"kind":"department_pool_grant","amount":"₹0.01"}'),
    ).toBeInTheDocument();
  });
});
