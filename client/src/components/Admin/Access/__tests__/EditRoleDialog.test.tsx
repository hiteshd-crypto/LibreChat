import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import EditRoleDialog from '../EditRoleDialog';

const mockUpdate = jest.fn();

const idle = (mutate: jest.Mock) => ({ mutate, reset: jest.fn(), isLoading: false, error: null });

jest.mock('~/data-provider', () => ({
  useUpdateRole: () => idle(mockUpdate),
  useDeleteRole: () => idle(jest.fn()),
  useAdminRoleMembers: () => ({ data: { members: [], total: 0 }, isLoading: false }),
  useAdminUserSearch: () => ({ data: { users: [] } }),
  useAddRoleMember: () => idle(jest.fn()),
  useRemoveRoleMember: () => idle(jest.fn()),
  MEMBERS_PAGE_SIZE: 20,
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
  OGDialog: ({ children }: any) => <div role="dialog">{children}</div>,
  OGDialogTemplate: ({ main }: any) => <div>{main}</div>,
}));

beforeEach(() => jest.clearAllMocks());

const getInput = (label: string) =>
  screen.getByText(label).closest('label')!.querySelector('input') as HTMLInputElement;

describe('EditRoleDialog', () => {
  it('sends an empty description so an existing one can be cleared', async () => {
    render(<EditRoleDialog role={{ name: 'support', description: 'temp' }} onClose={jest.fn()} />);
    const desc = getInput('com_admin_access_role_description');
    await userEvent.clear(desc);
    await userEvent.click(screen.getByText('com_ui_save'));
    expect(mockUpdate).toHaveBeenCalledWith(
      { name: 'support', updates: { name: undefined, description: '' } },
      expect.anything(),
    );
  });

  it('omits description when it is unchanged', async () => {
    render(<EditRoleDialog role={{ name: 'support', description: 'temp' }} onClose={jest.fn()} />);
    await userEvent.click(screen.getByText('com_ui_save'));
    expect(mockUpdate).toHaveBeenCalledWith(
      { name: 'support', updates: { name: undefined, description: undefined } },
      expect.anything(),
    );
  });

  it('disables the name field for a system role', () => {
    render(<EditRoleDialog role={{ name: 'ADMIN' }} onClose={jest.fn()} />);
    expect(getInput('com_admin_access_role_name')).toBeDisabled();
  });

  it('shows the Members tab for ADMIN', () => {
    render(<EditRoleDialog role={{ name: 'ADMIN' }} onClose={jest.fn()} />);
    expect(screen.getByText('com_admin_access_tab_members')).toBeInTheDocument();
  });

  it('hides the Members tab for the USER role and explains why', () => {
    render(<EditRoleDialog role={{ name: 'USER' }} onClose={jest.fn()} />);
    expect(screen.queryByText('com_admin_access_tab_members')).not.toBeInTheDocument();
    expect(screen.getByText('com_admin_access_user_role_note')).toBeInTheDocument();
  });
});
