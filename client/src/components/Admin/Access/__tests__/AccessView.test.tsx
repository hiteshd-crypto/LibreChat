import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import AccessView from '../AccessView';

const mockUseAdminRoles = jest.fn();
const mockCreateMutate = jest.fn();
const mockUpdateMutate = jest.fn();
const mockDeleteMutate = jest.fn();

const idleMutation = (mutate: jest.Mock) => ({
  mutate,
  reset: jest.fn(),
  isLoading: false,
  error: null,
});

jest.mock('~/data-provider', () => ({
  useAdminRoles: () => mockUseAdminRoles(),
  useCreateRole: () => idleMutation(mockCreateMutate),
  useUpdateRole: () => idleMutation(mockUpdateMutate),
  useDeleteRole: () => idleMutation(mockDeleteMutate),
  useAdminRoleMembers: () => ({ data: { members: [], total: 0 }, isLoading: false }),
  useAdminUserSearch: () => ({ data: { users: [] } }),
  useAddRoleMember: () => idleMutation(jest.fn()),
  useRemoveRoleMember: () => idleMutation(jest.fn()),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
  Spinner: () => <span data-testid="spinner" />,
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

beforeEach(() => jest.clearAllMocks());

describe('AccessView', () => {
  it('renders roles with a System badge for ADMIN/USER', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [{ name: 'ADMIN' }, { name: 'USER' }, { name: 'support' }], total: 3 },
      isLoading: false,
      isError: false,
    });
    render(<AccessView />);
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    expect(screen.getByText('support')).toBeInTheDocument();
    expect(screen.getAllByText('com_admin_access_system_badge')).toHaveLength(2);
  });

  it('shows a spinner while loading', () => {
    mockUseAdminRoles.mockReturnValue({ isLoading: true });
    render(<AccessView />);
    expect(screen.getByTestId('admin-roles-loading')).toBeInTheDocument();
  });

  it('shows an error state', () => {
    mockUseAdminRoles.mockReturnValue({ isLoading: false, isError: true });
    render(<AccessView />);
    expect(screen.getByText('com_admin_access_load_error')).toBeInTheDocument();
  });

  it('opens the create dialog and submits a new role', async () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [{ name: 'ADMIN' }], total: 1 },
      isLoading: false,
      isError: false,
    });
    render(<AccessView />);
    await userEvent.click(screen.getByText('com_admin_access_create_role'));
    const nameInput = screen.getByRole('dialog').querySelector('input') as HTMLInputElement;
    await userEvent.type(nameInput, 'support');
    await userEvent.click(screen.getByText('com_ui_create'));
    expect(mockCreateMutate).toHaveBeenCalledWith(
      { name: 'support', description: undefined },
      expect.anything(),
    );
  });

  it('filters roles by the search box', async () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [{ name: 'ADMIN' }, { name: 'support' }], total: 2 },
      isLoading: false,
      isError: false,
    });
    render(<AccessView />);
    await userEvent.type(screen.getByPlaceholderText('com_admin_access_search_placeholder'), 'sup');
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument();
    expect(screen.getByText('support')).toBeInTheDocument();
  });
});
