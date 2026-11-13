import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import {
  useMutation as mockUseMutation,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import DepartmentListView from '../DepartmentListView';

const mockRenameApi = jest.fn();
const mockDeleteApi = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock('~/data-provider', () => ({
  useDepartments: () => ({
    data: {
      departments: [
        { _id: 'dept-1', name: 'Accounting', rootRoleKey: 'ACCT_MGR', memberCount: 0 },
        { _id: 'dept-2', name: 'IT', rootRoleKey: 'IT_MGR', memberCount: 3 },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useCreateDepartment: () => ({ mutate: jest.fn(), isLoading: false, reset: jest.fn() }),
  useRenameDepartment: () =>
    mockUseMutation(({ departmentId, body }: { departmentId: string; body: { name: string } }) =>
      mockRenameApi(departmentId, body),
    ),
  useDeleteDepartment: () =>
    mockUseMutation(({ departmentId }: { departmentId: string }) => mockDeleteApi(departmentId)),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));

jest.mock('~/common', () => ({
  NotificationSeverity: { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' },
}));

const mockShowToast = jest.fn();

jest.mock('@librechat/client', () => ({
  Button: ({ children, variant: _v, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
  Spinner: () => <span data-testid="spinner" />,
  OGDialog: ({ open, onOpenChange, children }: any) =>
    open ? (
      <div role="dialog">
        {children}
        <button aria-label="close-dialog" onClick={() => onOpenChange(false)} />
      </div>
    ) : null,
  OGDialogTemplate: ({ title, main, buttons }: any) => (
    <div>
      <h2>{title}</h2>
      {main}
      {buttons}
    </div>
  ),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const quietLogger = { log: () => undefined, warn: () => undefined, error: () => undefined };

const renderView = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ logger: quietLogger, defaultOptions: { mutations: { retry: false } } })
      }
    >
      <DepartmentListView />
    </QueryClientProvider>,
  );

describe('DepartmentListView rename/delete', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renames a department and toasts success', async () => {
    mockRenameApi.mockResolvedValue({ department: { _id: 'dept-1', name: 'Finance' } });
    renderView();

    const [renameAccounting] = screen.getAllByRole('button', {
      name: 'com_admin_department_rename',
    });
    await userEvent.click(renameAccounting);
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'Finance');
    await userEvent.click(within(dialog).getByRole('button', { name: 'com_ui_save' }));

    expect(mockRenameApi).toHaveBeenCalledWith('dept-1', { name: 'Finance' });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_admin_department_renamed:Finance' }),
    );
  });

  it('warns about member count before deleting a non-empty department', async () => {
    renderView();

    const deleteButtons = screen.getAllByRole('button', { name: 'com_admin_department_delete' });
    // Second department ("IT") has memberCount: 3
    await userEvent.click(deleteButtons[1]);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('com_admin_department_delete_confirm_members:IT,3'),
    ).toBeInTheDocument();
  });

  it('deletes a department and toasts success', async () => {
    mockDeleteApi.mockResolvedValue({ success: true });
    renderView();

    const deleteButtons = screen.getAllByRole('button', { name: 'com_admin_department_delete' });
    await userEvent.click(deleteButtons[0]);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'com_ui_delete' }));

    expect(mockDeleteApi).toHaveBeenCalledWith('dept-1');
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_admin_department_deleted:Accounting' }),
    );
  });
});
