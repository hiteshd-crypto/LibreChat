import { useState } from 'react';
import { Spinner } from '@librechat/client';
import type { TDepartment } from 'librechat-data-provider';
import DepartmentGrantDialog from './DepartmentGrantDialog';
import { useDepartments } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Super Admin's Balance Distribution landing page: a Department list (no
 * individual-user picker) — selecting one opens `DepartmentGrantDialog` to
 * send a lump sum to that Department's head. */
export default function DepartmentGrantView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useDepartments();
  const [selected, setSelected] = useState<TDepartment | null>(null);

  const departments = data?.departments ?? [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-text-secondary">
        {localize('com_admin_access_load_error')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-text-primary">
        {localize('com_admin_department_grant_title')}
      </h3>

      {departments.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_department_list_empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2 md:max-w-sm">
          {departments.map((department) => (
            <li key={department._id}>
              <button
                type="button"
                onClick={() => setSelected(department)}
                className="w-full rounded-lg border border-border-light px-4 py-3 text-left text-sm text-text-primary transition-colors hover:bg-surface-hover"
              >
                {department.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <DepartmentGrantDialog department={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
