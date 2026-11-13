import DepartmentListView from './DepartmentListView';
import DepartmentTreeView from './DepartmentTreeView';
import { useMyHierarchy } from '~/data-provider';

/**
 * `/admin/access` landing page — a thin router on the caller's own hierarchy
 * access. A Super Admin sees the Department list and drills into one's tree
 * at `/admin/access/:departmentId` (see `DepartmentTreeRoute`). A Department
 * Head goes straight to their own branch's tree — no list, no drill-down
 * chrome, since they only ever have the one branch.
 */
export default function AccessView() {
  const { data: hierarchy } = useMyHierarchy();

  if (hierarchy?.isAdmin) {
    return <DepartmentListView />;
  }

  if (hierarchy?.departmentHead) {
    return <DepartmentTreeView departmentName={hierarchy.departmentHead.departmentName} />;
  }

  return null;
}
