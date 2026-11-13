import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Spinner, Button } from '@librechat/client';
import type { TDepartment } from 'librechat-data-provider';
import CreateDepartmentDialog from './CreateDepartmentDialog';
import RenameDepartmentDialog from './RenameDepartmentDialog';
import DeleteDepartmentDialog from './DeleteDepartmentDialog';
import { useDepartments } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Super Admin landing page for `/admin/access`: lists every Department and
 * lets the Super Admin drill into one's Hierarchy Management tree. */
export default function DepartmentListView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useDepartments();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TDepartment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TDepartment | null>(null);

  const departments = data?.departments ?? [];

  if (isLoading) {
    return (
      <div data-testid="admin-departments-loading" className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-text-secondary">{localize('com_admin_access_load_error')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text-primary">
          {localize('com_admin_departments_title')}
        </h2>
        <Button variant="submit" type="button" onClick={() => setCreateOpen(true)}>
          {localize('com_admin_department_create')}
        </Button>
      </div>

      {departments.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_department_list_empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {departments.map((department) => (
            <li
              key={department._id}
              className="flex items-center gap-2 rounded-lg border border-border-light px-4 py-3 text-sm text-text-primary"
            >
              <button
                type="button"
                onClick={() => navigate(`/admin/access/${department._id}`)}
                className="min-w-0 flex-1 truncate text-left transition-colors hover:text-text-secondary"
              >
                {department.name}
              </button>
              <button
                type="button"
                title={localize('com_admin_department_rename')}
                aria-label={localize('com_admin_department_rename')}
                className="shrink-0 text-text-secondary hover:text-text-primary"
                onClick={() => setRenameTarget(department)}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title={localize('com_admin_department_delete')}
                aria-label={localize('com_admin_department_delete')}
                className="shrink-0 text-text-secondary hover:text-text-destructive"
                onClick={() => setDeleteTarget(department)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <CreateDepartmentDialog open={createOpen} onOpenChange={setCreateOpen} />
      <RenameDepartmentDialog department={renameTarget} onClose={() => setRenameTarget(null)} />
      <DeleteDepartmentDialog department={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
