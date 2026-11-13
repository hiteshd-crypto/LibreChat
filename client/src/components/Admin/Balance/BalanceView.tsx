import SuperAdminBalanceView from './SuperAdminBalanceView';
import DepartmentBalanceView from './DepartmentBalanceView';
import { useMyHierarchy } from '~/data-provider';

/**
 * `/admin/balance` — a Super Admin gets the existing all-users, editable view
 * (`SuperAdminBalanceView`). A Department Head gets a read-only view scoped to
 * their own department's members (`DepartmentBalanceView`) — they can see
 * balances but never edit one; editing stays an Admin-only action enforced
 * server-side regardless of what renders here.
 */
export default function BalanceView() {
  const { data: hierarchy } = useMyHierarchy();

  if (hierarchy?.isAdmin) {
    return <SuperAdminBalanceView />;
  }

  if (hierarchy?.departmentHead) {
    return <DepartmentBalanceView />;
  }

  return null;
}
