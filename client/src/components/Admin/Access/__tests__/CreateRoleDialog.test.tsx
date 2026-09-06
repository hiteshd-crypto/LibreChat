import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import CreateRoleDialog from '../CreateRoleDialog';

const mockCreateMutate = jest.fn();
const mockUseAdminRoles = jest.fn();

jest.mock('~/data-provider', () => ({
  useCreateRole: () => ({
    mutate: mockCreateMutate,
    reset: jest.fn(),
    isLoading: false,
    error: null,
  }),
  useAdminRoles: () => mockUseAdminRoles(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/utils', () => ({
  getResponseErrorMessage: (e: unknown) => String(e),
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
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

beforeEach(() => jest.clearAllMocks());

describe('CreateRoleDialog', () => {
  it('offers a top-level option plus every non-system role as a parent', () => {
    mockUseAdminRoles.mockReturnValue({
      data: { roles: [{ name: 'ADMIN' }, { name: 'USER' }, { name: 'SUPERVISOR', depth: 0 }] },
    });
    render(<CreateRoleDialog open onOpenChange={() => {}} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['com_admin_role_top_level', 'SUPERVISOR']));
    expect(options).not.toContain('ADMIN');
    expect(options).not.toContain('USER');
  });

  it('submits with the selected parentRole', async () => {
    mockUseAdminRoles.mockReturnValue({ data: { roles: [{ name: 'SUPERVISOR', depth: 0 }] } });
    render(<CreateRoleDialog open onOpenChange={() => {}} />);

    const inputs = screen.getAllByRole('textbox');
    await userEvent.type(inputs[0], 'SALES_MANAGER');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'SUPERVISOR');
    await userEvent.click(screen.getByText('com_ui_create'));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SALES_MANAGER', parentRole: 'SUPERVISOR' }),
      expect.any(Object),
    );
  });

  it('submits a top-level role with parentRole null', async () => {
    mockUseAdminRoles.mockReturnValue({ data: { roles: [] } });
    render(<CreateRoleDialog open onOpenChange={() => {}} />);

    await userEvent.type(screen.getAllByRole('textbox')[0], 'SUPERVISOR');
    await userEvent.click(screen.getByText('com_ui_create'));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SUPERVISOR', parentRole: null }),
      expect.any(Object),
    );
  });
});
