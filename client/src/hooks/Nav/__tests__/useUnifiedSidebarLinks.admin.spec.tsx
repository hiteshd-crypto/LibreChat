import { renderHook } from '@testing-library/react';
import { SystemRoles } from 'librechat-data-provider';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

const mockAuthState: { user?: { role?: string } } = { user: undefined };

jest.mock('recoil', () => ({
  ...jest.requireActual('recoil'),
  useRecoilValue: jest.fn(() => undefined),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/c/new' }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useUserKeyQuery: () => ({ data: { expiresAt: undefined } }),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: {} }),
  useGetStartupConfig: () => ({ data: { insightsEnabled: false } }),
  useInsightsAccessQuery: () => ({ data: { access: false } }),
}));

jest.mock('~/hooks/Nav/useSideNavLinks', () => ({
  __esModule: true,
  default: () => [{ id: 'mcp-builder', title: 'com_ui_mcp', label: '', icon: () => null }],
}));

jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => mockAuthState,
}));

describe('useUnifiedSidebarLinks — admin entry', () => {
  it('adds an Admin link for ADMIN users', () => {
    mockAuthState.user = { role: SystemRoles.ADMIN };
    const { result } = renderHook(() => useUnifiedSidebarLinks());
    expect(result.current.some((l) => l.id === 'admin')).toBe(true);
  });

  it('omits the Admin link for regular users', () => {
    mockAuthState.user = { role: SystemRoles.USER };
    const { result } = renderHook(() => useUnifiedSidebarLinks());
    expect(result.current.some((l) => l.id === 'admin')).toBe(false);
  });
});
