import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import RoleMembersPanel from '../RoleMembersPanel';

const mockUseAdminRoleMembers = jest.fn();
const mockUseAdminUserSearch = jest.fn();
const mockRemove = jest.fn();
const removeState: { error: unknown } = { error: null };

jest.mock('~/data-provider', () => ({
  useAdminRoleMembers: () => mockUseAdminRoleMembers(),
  useAdminUserSearch: () => mockUseAdminUserSearch(),
  useAddRoleMember: () => ({ mutate: jest.fn(), error: null }),
  useRemoveRoleMember: () => ({ mutate: mockRemove, error: removeState.error }),
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
}));

beforeEach(() => {
  jest.clearAllMocks();
  removeState.error = null;
  mockUseAdminRoleMembers.mockReturnValue({
    data: { members: [{ userId: 'u1', name: 'Ann', email: 'a@x.io' }], total: 1 },
    isLoading: false,
  });
  mockUseAdminUserSearch.mockReturnValue({ data: { users: [] } });
});

describe('RoleMembersPanel', () => {
  it('lists members and calls remove on click', async () => {
    render(<RoleMembersPanel roleName="ADMIN" />);
    expect(screen.getByText('Ann')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /com_admin_access_remove_member/ }));
    expect(mockRemove).toHaveBeenCalledWith({ roleName: 'ADMIN', userId: 'u1' });
  });

  it("surfaces the server's message, not the generic axios one", () => {
    removeState.error = {
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { data: { error: 'Cannot remove the last admin user' } },
    };
    render(<RoleMembersPanel roleName="ADMIN" />);
    expect(screen.getByText('Cannot remove the last admin user')).toBeInTheDocument();
    expect(screen.queryByText('Request failed with status code 400')).not.toBeInTheDocument();
  });
});
