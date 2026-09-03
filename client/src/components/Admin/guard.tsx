import { Navigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';

/**
 * Client-side gate for the admin area. Returns a redirect element for
 * non-admins (render it early), or `null` for admins. This is defense in
 * depth only — the real enforcement is the capability middleware on
 * `/api/admin/*`.
 *
 * Gates on the ADMIN role rather than the `ACCESS_ADMIN` capability the
 * backend checks. For the standard ADMIN/USER model these are equivalent;
 * a custom role granted `ACCESS_ADMIN` would pass the API but be redirected
 * here. Making this capability-aware needs a capability query — deliberately
 * out of scope for the role-only gating this feature ships with.
 */
export function useAdminGuard(): React.ReactElement | null {
  const { user } = useAuthContext();
  if (user?.role !== SystemRoles.ADMIN) {
    return <Navigate to="/c/new" replace />;
  }
  return null;
}
