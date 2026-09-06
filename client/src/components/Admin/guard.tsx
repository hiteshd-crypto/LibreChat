import { Navigate } from 'react-router-dom';
import { useMyHierarchy } from '~/data-provider';

/**
 * Client-side gate for the admin area. Returns a redirect element once the
 * hierarchy query resolves and the caller is neither an admin nor a hierarchy
 * role with visible subordinates; returns `null` while the query is loading or
 * when the caller is admitted.
 *
 * This is defense in depth only — the real enforcement is
 * `requireAnyCapability` / `requireSubordinateAccess` on `/api/admin/*`. The
 * layout decides which tabs a non-admin hierarchy role actually sees.
 */
export function useAdminGuard(): React.ReactElement | null {
  const { data, isLoading } = useMyHierarchy();
  if (isLoading) {
    return null;
  }
  if (!data?.isAdmin && !data?.canViewSubordinates) {
    return <Navigate to="/c/new" replace />;
  }
  return null;
}
