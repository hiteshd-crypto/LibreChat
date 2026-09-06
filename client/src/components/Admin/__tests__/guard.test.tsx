import { renderHook } from '@testing-library/react';
import { useAdminGuard } from '../guard';

const mockUseMyHierarchy = jest.fn();

jest.mock('~/data-provider', () => ({ useMyHierarchy: () => mockUseMyHierarchy() }));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  Navigate: () => null,
}));

describe('useAdminGuard', () => {
  it('renders nothing while the hierarchy query is loading', () => {
    mockUseMyHierarchy.mockReturnValue({ data: undefined, isLoading: true });
    const { result } = renderHook(() => useAdminGuard());
    expect(result.current).toBeNull();
  });

  it('redirects a plain user once loading finishes', () => {
    mockUseMyHierarchy.mockReturnValue({
      data: {
        isAdmin: false,
        canViewSubordinates: false,
        viewableRoleNames: [],
        manageableRoleNames: [],
      },
      isLoading: false,
    });
    const { result } = renderHook(() => useAdminGuard());
    expect(result.current).not.toBeNull();
  });

  it('passes an admin through', () => {
    mockUseMyHierarchy.mockReturnValue({
      data: {
        isAdmin: true,
        canViewSubordinates: true,
        viewableRoleNames: [],
        manageableRoleNames: [],
      },
      isLoading: false,
    });
    const { result } = renderHook(() => useAdminGuard());
    expect(result.current).toBeNull();
  });

  it('passes a hierarchy role with subordinates through', () => {
    mockUseMyHierarchy.mockReturnValue({
      data: {
        isAdmin: false,
        canViewSubordinates: true,
        viewableRoleNames: ['SALES_EMPLOYEE'],
        manageableRoleNames: ['SALES_EMPLOYEE'],
      },
      isLoading: false,
    });
    const { result } = renderHook(() => useAdminGuard());
    expect(result.current).toBeNull();
  });
});
