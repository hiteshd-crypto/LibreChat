import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TAdminRole } from 'librechat-data-provider';
import EditRoleDialog from '../EditRoleDialog';

const mockUpdate = jest.fn();
const mockDelete = jest.fn();

/** react-query v4 mutation stub — the dialog uses `mutateAsync`. */
const idle = (fn: jest.Mock) => ({
  mutate: fn,
  mutateAsync: fn,
  reset: jest.fn(),
  isLoading: false,
  error: null,
});

jest.mock('~/data-provider', () => ({
  useUpdateRole: () => idle(mockUpdate),
  useDeleteRole: () => idle(mockDelete),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue({ role: {} });
});

const role = (overrides: Partial<TAdminRole>): TAdminRole =>
  ({ roleKey: overrides.name ?? 'k', name: 'support', ...overrides }) as TAdminRole;

const getInput = (label: string) =>
  screen.getByText(label).closest('label')!.querySelector('input') as HTMLInputElement;

describe('EditRoleDialog', () => {
  it('sends an empty description so an existing one can be cleared, keyed by roleKey', async () => {
    render(
      <EditRoleDialog role={role({ name: 'support', description: 'temp' })} onClose={jest.fn()} />,
    );
    await userEvent.clear(getInput('com_admin_access_role_description'));
    await userEvent.click(screen.getByText('com_ui_save'));
    expect(mockUpdate).toHaveBeenCalledWith({
      roleKey: 'support',
      updates: { name: undefined, description: '' },
    });
  });

  it('does nothing but close when nothing changed', async () => {
    const onClose = jest.fn();
    render(
      <EditRoleDialog role={role({ name: 'support', description: 'temp' })} onClose={onClose} />,
    );
    await userEvent.click(screen.getByText('com_ui_save'));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('disables the name field for a system role', () => {
    render(<EditRoleDialog role={role({ name: 'ADMIN' })} onClose={jest.fn()} />);
    expect(getInput('com_admin_access_role_name')).toBeDisabled();
  });

  it('shows the Members tab for ADMIN', () => {
    render(<EditRoleDialog role={role({ name: 'ADMIN' })} onClose={jest.fn()} />);
    expect(screen.getByText('com_admin_access_tab_members')).toBeInTheDocument();
  });

  it('hides the Members tab for the USER role and explains why', () => {
    render(<EditRoleDialog role={role({ name: 'USER' })} onClose={jest.fn()} />);
    expect(screen.queryByText('com_admin_access_tab_members')).not.toBeInTheDocument();
    expect(screen.getByText('com_admin_access_user_role_note')).toBeInTheDocument();
  });

  it('shows "Reports to" as a static label, not a control, and never re-parents on save', async () => {
    render(
      <EditRoleDialog
        role={role({ name: 'support', parentRole: 'p1' })}
        parentName="SALES_MANAGER"
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('SALES_MANAGER')).toBeInTheDocument();

    await userEvent.clear(getInput('com_admin_access_role_description'));
    await userEvent.type(getInput('com_admin_access_role_description'), 'new');
    await userEvent.click(screen.getByText('com_ui_save'));
    expect(mockUpdate).toHaveBeenCalledWith({
      roleKey: 'support',
      updates: { name: undefined, description: 'new' },
    });
  });

  it('shows "Top-level branch" when the role has no parent', () => {
    render(
      <EditRoleDialog role={role({ name: 'support', parentRole: null })} onClose={jest.fn()} />,
    );
    expect(screen.getByText('com_admin_role_top_level')).toBeInTheDocument();
  });

  it('hides the Reports-to line for a system role', () => {
    render(<EditRoleDialog role={role({ name: 'ADMIN' })} onClose={jest.fn()} />);
    expect(screen.queryByText('com_admin_role_parent_label:')).not.toBeInTheDocument();
  });
});
