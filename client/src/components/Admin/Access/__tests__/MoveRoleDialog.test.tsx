import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TAdminRole } from 'librechat-data-provider';
import MoveRoleDialog from '../MoveRoleDialog';

const mockMutate = jest.fn();

jest.mock('~/data-provider', () => ({
  useSetRoleParent: () => ({ mutate: mockMutate, reset: jest.fn(), isLoading: false, error: null }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

jest.mock('~/utils', () => ({ getResponseErrorMessage: (e: unknown) => String(e) }));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Spinner: () => <span data-testid="spinner" />,
  OGDialog: ({ children }: any) => <div role="dialog">{children}</div>,
  OGDialogTemplate: ({ main, buttons }: any) => (
    <div>
      {main}
      {buttons}
    </div>
  ),
}));

const r = (roleKey: string, name: string, parentRole: string | null = null): TAdminRole => ({
  roleKey,
  name,
  parentRole,
});

const roles = [r('sup', 'SUP'), r('mgr', 'MGR', 'sup'), r('emp', 'EMP', 'mgr')];
const labelMap = new Map(roles.map((role) => [role.roleKey, role.name]));

beforeEach(() => jest.clearAllMocks());

describe('MoveRoleDialog', () => {
  it('renders nothing when there is no move intent', () => {
    const { container } = render(
      <MoveRoleDialog move={null} roles={roles} labelMap={labelMap} onClose={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('confirms a preset drop target and calls useSetRoleParent with keys', async () => {
    render(
      <MoveRoleDialog
        move={{ role: roles[2], newParentKey: 'sup' }}
        roles={roles}
        labelMap={labelMap}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText(/com_admin_role_move_confirm/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('com_ui_confirm'));
    expect(mockMutate).toHaveBeenCalledWith(
      { roleKey: 'emp', parentRole: 'sup' },
      expect.any(Object),
    );
  });

  it('keyboard mode offers only same-branch, non-descendant targets', async () => {
    render(
      <MoveRoleDialog
        move={{ role: roles[2] }}
        roles={roles}
        labelMap={labelMap}
        onClose={jest.fn()}
      />,
    );
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    // 'SUP' is a valid target; 'EMP' (self) and 'MGR' (current parent) are not.
    expect(options).toContain('SUP');
    expect(options).not.toContain('EMP');
    expect(options).not.toContain('MGR');
  });
});
