import { renderHook } from '@testing-library/react';
import { SystemRoles } from 'librechat-data-provider';
import { useAdminGuard } from '../guard';

const mockUseAuthContext = jest.fn();

jest.mock('~/hooks', () => ({ useAuthContext: () => mockUseAuthContext() }));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  Navigate: () => null,
}));

describe('useAdminGuard', () => {
  it('redirects a non-admin user', () => {
    mockUseAuthContext.mockReturnValue({ user: { role: SystemRoles.USER } });
    const { result } = renderHook(() => useAdminGuard());
    expect(result.current).not.toBeNull();
  });

  it('redirects when there is no user', () => {
    mockUseAuthContext.mockReturnValue({ user: undefined });
    const { result } = renderHook(() => useAdminGuard());
    expect(result.current).not.toBeNull();
  });

  it('passes an admin through', () => {
    mockUseAuthContext.mockReturnValue({ user: { role: SystemRoles.ADMIN } });
    const { result } = renderHook(() => useAdminGuard());
    expect(result.current).toBeNull();
  });
});
