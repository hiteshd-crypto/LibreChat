/* eslint-disable i18next/no-literal-string */
import { render, screen } from '@testing-library/react';
import BalanceView from '../BalanceView';

const mockUseMyHierarchy = jest.fn();

jest.mock('~/data-provider', () => ({
  useMyHierarchy: () => mockUseMyHierarchy(),
}));

jest.mock('../SuperAdminBalanceView', () => () => <div>super-admin-view</div>);
jest.mock('../DepartmentBalanceView', () => () => <div>department-head-view</div>);

describe('BalanceView router', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the Super Admin view for an admin', () => {
    mockUseMyHierarchy.mockReturnValue({ data: { isAdmin: true } });
    render(<BalanceView />);
    expect(screen.getByText('super-admin-view')).toBeInTheDocument();
    expect(screen.queryByText('department-head-view')).not.toBeInTheDocument();
  });

  it('renders the Department Head view for a department head', () => {
    mockUseMyHierarchy.mockReturnValue({
      data: { isAdmin: false, departmentHead: { departmentId: 'dept-1', departmentName: 'IT' } },
    });
    render(<BalanceView />);
    expect(screen.getByText('department-head-view')).toBeInTheDocument();
    expect(screen.queryByText('super-admin-view')).not.toBeInTheDocument();
  });

  it('renders nothing for a caller who is neither', () => {
    mockUseMyHierarchy.mockReturnValue({ data: { isAdmin: false } });
    const { container } = render(<BalanceView />);
    expect(container).toBeEmptyDOMElement();
  });
});
