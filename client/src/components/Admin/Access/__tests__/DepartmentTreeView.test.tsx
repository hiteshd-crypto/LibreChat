import { DndProvider } from 'react-dnd';
import userEvent from '@testing-library/user-event';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import DepartmentTreeView from '../DepartmentTreeView';

const mockUseAdminRoles = jest.fn();

const idleMutation = (mutate = jest.fn()) => ({
  mutate,
  mutateAsync: mutate,
  reset: jest.fn(),
  isLoading: false,
  error: null,
});

jest.mock('~/data-provider', () => ({
  useAdminRoles: () => mockUseAdminRoles(),
  useUpdateRole: () => idleMutation(),
  useDeleteRole: () => idleMutation(),
  useCreateRole: () => idleMutation(),
  useSetRoleParent: () => idleMutation(),
  useAdminRoleMembers: () => ({ data: { members: [], total: 0 }, isLoading: false }),
  useAdminUserSearch: () => ({ data: { users: [] } }),
  useAddRoleMember: () => idleMutation(),
  useRemoveRoleMember: () => idleMutation(),
  useDepartments: () => ({ data: { departments: [] }, isLoading: false, isError: false }),
  useSetDepartmentHead: () => idleMutation(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
  Spinner: () => <span data-testid="spinner" />,
  useToastContext: () => ({ showToast: jest.fn() }),
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
  OGDialog: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
  OGDialogTemplate: ({ title, main, buttons }: any) => (
    <div>
      <h2>{title}</h2>
      {main}
      {buttons}
    </div>
  ),
}));

const withDnd = (ui: ReactElement) =>
  render(<DndProvider backend={HTML5Backend}>{ui}</DndProvider>);

const r = (name: string, depth = 0, parentRole: string | null = null) => ({
  roleKey: `${name}-key`,
  name,
  depth,
  parentRole,
});

beforeEach(() => jest.clearAllMocks());

describe('DepartmentTreeView', () => {
  it('renders roles with a System badge for ADMIN/USER and action buttons per role type', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('ADMIN'), r('USER'), r('support')], total: 3 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView />);
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    expect(screen.getByText('support')).toBeInTheDocument();
    expect(screen.getAllByText('com_admin_access_system_badge')).toHaveLength(2);
    // ADMIN/USER get Edit only; a top-level custom role gets Add + Edit (no move handle).
    expect(screen.getAllByLabelText('com_admin_role_action_edit')).toHaveLength(3);
    expect(screen.getAllByLabelText('com_admin_role_action_add')).toHaveLength(1);
    expect(screen.queryByLabelText('com_admin_role_action_move')).not.toBeInTheDocument();
  });

  it('gives a nested custom role a move handle', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('SUP'), r('MGR', 1, 'SUP-key')], total: 2 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView />);
    expect(screen.getAllByLabelText('com_admin_role_action_move')).toHaveLength(1);
  });

  it('shows a spinner while loading', () => {
    mockUseAdminRoles.mockReturnValue({ isLoading: true });
    withDnd(<DepartmentTreeView />);
    expect(screen.getByTestId('admin-roles-loading')).toBeInTheDocument();
  });

  it('shows an error state', () => {
    mockUseAdminRoles.mockReturnValue({ isLoading: false, isError: true });
    withDnd(<DepartmentTreeView />);
    expect(screen.getByText('com_admin_access_load_error')).toBeInTheDocument();
  });

  it('renders a create-role button that opens the dialog', async () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('ADMIN')], total: 1 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView />);
    const openButtons = screen.getAllByText('com_admin_access_create_title');
    expect(openButtons).toHaveLength(1);
    await userEvent.click(openButtons[0]);
    expect(screen.getAllByText('com_admin_access_create_title').length).toBeGreaterThan(1);
  });

  it('indents child roles by depth', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('SUPERVISOR'), r('SALES_MANAGER', 1, 'SUPERVISOR-key')], total: 2 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView />);
    const child = screen.getByText('SALES_MANAGER').closest('div[style]') as HTMLElement;
    expect(child).toHaveStyle({ marginLeft: '1.25rem' });
  });

  it('filters roles by the search box', async () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('ADMIN'), r('support')], total: 2 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView />);
    await userEvent.type(screen.getByPlaceholderText('com_admin_access_search_placeholder'), 'sup');
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument();
    expect(screen.getByText('support')).toBeInTheDocument();
  });

  it('renders the department name as a heading when provided', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('ADMIN')], total: 1 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView departmentName="Finance" />);
    expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument();
  });

  it('renders no heading when departmentName is omitted', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('ADMIN')], total: 1 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders zero rows for an empty department (scopeRootRoleKey: null) regardless of the unscoped fetch', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [r('ADMIN'), r('support'), r('IT')], total: 3 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView scopeRootRoleKey={null} departmentId="dept-1" />);
    expect(screen.queryByText('support')).not.toBeInTheDocument();
    expect(screen.queryByText('IT')).not.toBeInTheDocument();
    expect(screen.getByText('com_admin_access_empty')).toBeInTheDocument();
    // The top-level Create action remains the only way to add the first role.
    expect(screen.getByText('com_admin_access_create_title')).toBeInTheDocument();
  });

  it('forwards departmentId to the top-level create dialog only for an empty department', async () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [], total: 0 },
      isLoading: false,
      isError: false,
    });
    withDnd(<DepartmentTreeView scopeRootRoleKey={null} departmentId="dept-1" />);
    await userEvent.click(screen.getByText('com_admin_access_create_title'));
    expect(screen.getByText('com_admin_department_add_head_title')).toBeInTheDocument();
  });
});
