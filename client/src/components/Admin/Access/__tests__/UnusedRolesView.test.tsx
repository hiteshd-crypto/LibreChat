import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import UnusedRolesView from '../UnusedRolesView';

const mockUseAdminRoles = jest.fn();
const mockUseDepartments = jest.fn();
const mockUseMyHierarchy = jest.fn();
const mockDelete = jest.fn();
const mockNavigate = jest.fn();

const idleMutation = (mutate = mockDelete, error: Error | null = null) => ({
  mutate,
  mutateAsync: mutate,
  reset: jest.fn(),
  isLoading: false,
  error,
});

jest.mock('~/data-provider', () => ({
  useAdminRoles: () => mockUseAdminRoles(),
  useDepartments: () => mockUseDepartments(),
  useMyHierarchy: () => mockUseMyHierarchy(),
  useDeleteRole: () => idleMutation(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Spinner: () => <span data-testid="spinner" />,
  OGDialog: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
  OGDialogTemplate: ({ title, main, buttons }: any) => (
    <div>
      <h2>{title}</h2>
      {main}
      {buttons}
    </div>
  ),
}));

const r = (name: string, parentRole: string | null = null, description?: string) => ({
  roleKey: `${name}-key`,
  name,
  parentRole,
  description,
});

const adminHierarchy = { isAdmin: true, canViewSubordinates: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseMyHierarchy.mockReturnValue({ data: adminHierarchy, isLoading: false });
  mockUseDepartments.mockReturnValue({
    data: { departments: [] },
    isLoading: false,
    isError: false,
  });
});

describe('UnusedRolesView', () => {
  it('shows only roles whose whole branch is unclaimed by any department', () => {
    mockUseAdminRoles.mockReturnValue({
      data: {
        roles: [
          r('ADMIN'),
          r('USER'),
          r('Sales'),
          r('SalesManager', 'Sales-key'),
          r('Orphan'),
          r('OrphanChild', 'Orphan-key'),
        ],
      },
      isLoading: false,
      isError: false,
    });
    mockUseDepartments.mockReturnValue({
      data: { departments: [{ _id: 'd1', name: 'Sales', rootRoleKey: 'Sales-key' }] },
      isLoading: false,
      isError: false,
    });

    render(<UnusedRolesView />);

    expect(screen.getByText('Orphan')).toBeInTheDocument();
    expect(screen.getByText('OrphanChild')).toBeInTheDocument();
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    expect(screen.queryByText('SalesManager')).not.toBeInTheDocument();
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument();
    expect(screen.queryByText('USER')).not.toBeInTheDocument();
  });

  it('shows the empty state when every role belongs to a department', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('ADMIN'), r('Sales')] },
      isLoading: false,
      isError: false,
    });
    mockUseDepartments.mockReturnValue({
      data: { departments: [{ _id: 'd1', name: 'Sales', rootRoleKey: 'Sales-key' }] },
      isLoading: false,
      isError: false,
    });

    render(<UnusedRolesView />);
    expect(screen.getByText('com_admin_unused_roles_empty')).toBeInTheDocument();
  });

  it('opens the delete dialog for the clicked role and confirms with its roleKey', async () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('Orphan', null, 'An orphaned role')] },
      isLoading: false,
      isError: false,
    });

    render(<UnusedRolesView />);
    await userEvent.click(screen.getByLabelText('com_ui_delete'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByText('com_ui_delete'));
    expect(mockDelete).toHaveBeenCalledWith(
      { roleKey: 'Orphan-key' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('shows a spinner while roles or departments are loading', () => {
    mockUseAdminRoles.mockReturnValue({ isLoading: true });
    render(<UnusedRolesView />);
    expect(screen.getByTestId('unused-roles-loading')).toBeInTheDocument();
  });

  it('shows an error state when either query fails', () => {
    mockUseAdminRoles.mockReturnValue({ isLoading: false, isError: true });
    render(<UnusedRolesView />);
    expect(screen.getByText('com_admin_access_load_error')).toBeInTheDocument();
  });

  it('redirects away when the caller is not the Super Admin', () => {
    mockUseMyHierarchy.mockReturnValue({ data: { isAdmin: false }, isLoading: false });
    mockUseAdminRoles.mockReturnValue({ data: { roles: [] }, isLoading: false, isError: false });

    render(<UnusedRolesView />);
    const navigate = screen.getByTestId('navigate');
    expect(navigate).toHaveAttribute('data-to', '/admin/access');
    expect(screen.queryByText('com_admin_unused_roles_title')).not.toBeInTheDocument();
  });

  it('navigates back to Hierarchy Management', async () => {
    mockUseAdminRoles.mockReturnValue({ data: { roles: [] }, isLoading: false, isError: false });
    render(<UnusedRolesView />);
    await userEvent.click(screen.getByText('com_admin_unused_roles_back'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/access');
  });
});
