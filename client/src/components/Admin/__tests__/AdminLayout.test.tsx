import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import AdminLayout from '../AdminLayout';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Outlet: () => <div data-testid="outlet" />,
  NavLink: ({ children }: any) => (
    <span>{typeof children === 'function' ? children({}) : children}</span>
  ),
}));

jest.mock('../guard', () => ({ useAdminGuard: () => null }));

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/utils', () => ({ cn: (...c: string[]) => c.filter(Boolean).join(' ') }));

beforeEach(() => jest.clearAllMocks());

describe('AdminLayout', () => {
  it('renders a Back to chat control that navigates to /c/new', async () => {
    render(<AdminLayout />);
    await userEvent.click(screen.getByRole('button', { name: /com_admin_back_to_chat/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/c/new');
  });

  it('renders the Access and Users tabs', () => {
    render(<AdminLayout />);
    expect(screen.getByText('com_admin_access_title')).toBeInTheDocument();
    expect(screen.getByText('com_admin_users_title')).toBeInTheDocument();
  });
});
