import { render, screen } from '@testing-library/react';
import AccessView from '../AccessView';

const mockUseMyHierarchy = jest.fn();

jest.mock('~/data-provider', () => ({
  useMyHierarchy: () => mockUseMyHierarchy(),
}));

jest.mock('../DepartmentListView', () => () => <div data-testid="department-list-view" />);
jest.mock('../DepartmentTreeView', () => () => <div data-testid="department-tree-view" />);

beforeEach(() => jest.clearAllMocks());

describe('AccessView', () => {
  it('renders the Department list for a Super Admin', () => {
    mockUseMyHierarchy.mockReturnValue({ data: { isAdmin: true } });
    render(<AccessView />);
    expect(screen.getByTestId('department-list-view')).toBeInTheDocument();
    expect(screen.queryByTestId('department-tree-view')).not.toBeInTheDocument();
  });

  it("renders the caller's own Department tree directly for a Department Head", () => {
    mockUseMyHierarchy.mockReturnValue({
      data: {
        isAdmin: false,
        departmentHead: { departmentId: 'd1', departmentName: 'Accounting', rootRoleKey: 'ACCT' },
      },
    });
    render(<AccessView />);
    expect(screen.getByTestId('department-tree-view')).toBeInTheDocument();
    expect(screen.queryByTestId('department-list-view')).not.toBeInTheDocument();
  });

  it('renders nothing for a caller who is neither an admin nor a Department Head', () => {
    mockUseMyHierarchy.mockReturnValue({ data: { isAdmin: false } });
    const { container } = render(<AccessView />);
    expect(container).toBeEmptyDOMElement();
  });
});
