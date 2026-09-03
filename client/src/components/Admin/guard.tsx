import { Navigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';

/**
 * Client-side gate for the admin area. Returns a redirect element for
 * non-admins (render it early), or `null` for admins. This is defense in
 * depth only — the real enforcement is the capability middleware on
 * `/api/admin/*`.
 */
export function useAdminGuard(): React.ReactElement | null {
  const { user } = useAuthContext();
  if (user?.role !== SystemRoles.ADMIN) {
    return <Navigate to="/c/new" replace />;
  }
  return null;
}
