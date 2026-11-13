import { Spinner } from '@librechat/client';
import { useParams } from 'react-router-dom';
import DepartmentTreeView from './DepartmentTreeView';
import { useDepartments } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Route target for the Super Admin's `/admin/access/:departmentId` drill-down.
 * Resolves the department's `rootRoleKey` client-side and hands it to
 * `DepartmentTreeView` as a display-only filter — the server returns every
 * role unscoped for an ACCESS_ADMIN caller regardless. */
export default function DepartmentTreeRoute() {
  const localize = useLocalize();
  const { departmentId } = useParams<{ departmentId: string }>();
  const { data, isLoading, isError } = useDepartments();

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-text-secondary">{localize('com_admin_access_load_error')}</p>;
  }

  const department = data?.departments.find((d) => d._id === departmentId);
  if (!department) {
    return (
      <p className="text-sm text-text-secondary">{localize('com_admin_department_list_empty')}</p>
    );
  }

  return (
    <DepartmentTreeView
      scopeRootRoleKey={department.rootRoleKey}
      departmentId={department._id}
      departmentName={department.name}
    />
  );
}
