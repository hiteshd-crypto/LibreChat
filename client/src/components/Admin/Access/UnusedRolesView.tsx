import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { Navigate, useNavigate } from 'react-router-dom';
import type { TAdminRole } from 'librechat-data-provider';
import DeleteConfirmDialog from '~/components/DeleteConfirmDialog/DeleteConfirmDialog';
import { useAdminRoles, useDepartments, useMyHierarchy } from '~/data-provider';
import { orderRolesByTree } from './roleTree';
import { buildRoleMaps } from './reparent';
import { SYSTEM_ROLES } from './constants';
import { useLocalize } from '~/hooks';

/**
 * Super Admin-only page listing every role whose top-level branch is not
 * currently claimed by any department's `rootRoleKey` — the cleanup view for
 * roles created without a department link, or left behind after a department
 * was deleted. Computed live from already-fetched roles/departments; a role
 * dropped here the moment its branch is claimed (`useDepartments`/`useAdminRoles`
 * both get invalidated by the mutations that claim or delete a role).
 */
export default function UnusedRolesView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { data: hierarchy, isLoading: hierarchyLoading } = useMyHierarchy();
  const { data: rolesData, isLoading: rolesLoading, isError: rolesError } = useAdminRoles();
  const {
    data: departmentsData,
    isLoading: departmentsLoading,
    isError: departmentsError,
  } = useDepartments();
  const [deleteTarget, setDeleteTarget] = useState<TAdminRole | null>(null);

  const allRoles = useMemo(() => rolesData?.roles ?? [], [rolesData?.roles]);
  const departments = useMemo(
    () => departmentsData?.departments ?? [],
    [departmentsData?.departments],
  );
  const maps = useMemo(() => buildRoleMaps(allRoles), [allRoles]);

  const claimedRootKeys = useMemo(
    () =>
      new Set(
        departments
          .map((department) => department.rootRoleKey)
          .filter((key): key is string => key != null),
      ),
    [departments],
  );

  const unusedRoles = useMemo(
    () =>
      allRoles.filter(
        (role) =>
          !SYSTEM_ROLES.has(role.name) &&
          !claimedRootKeys.has(maps.rootKeyByKey.get(role.roleKey) ?? role.roleKey),
      ),
    [allRoles, maps, claimedRootKeys],
  );

  const orderedRoles = useMemo(() => orderRolesByTree(unusedRoles), [unusedRoles]);

  if (hierarchyLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (!hierarchy?.isAdmin) {
    return <Navigate to="/admin/access" replace />;
  }

  const isLoading = rolesLoading || departmentsLoading;
  const isError = rolesError || departmentsError;

  const renderBody = () => {
    if (isLoading) {
      return (
        <div data-testid="unused-roles-loading" className="flex justify-center py-10">
          <Spinner />
        </div>
      );
    }
    if (isError) {
      return (
        <p className="text-sm text-text-secondary">{localize('com_admin_access_load_error')}</p>
      );
    }
    if (orderedRoles.length === 0) {
      return (
        <p className="text-sm text-text-secondary">{localize('com_admin_unused_roles_empty')}</p>
      );
    }
    return orderedRoles.map(({ role, depth }) => (
      <div
        key={role.roleKey}
        style={{ marginLeft: `${depth * 1.25}rem` }}
        className="flex items-center gap-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium text-text-primary">{role.name}</span>
          {role.description ? (
            <span className="block truncate text-xs text-text-secondary">{role.description}</span>
          ) : null}
        </span>
        <button
          type="button"
          title={localize('com_ui_delete')}
          aria-label={localize('com_ui_delete')}
          className="shrink-0 text-text-secondary hover:text-text-destructive"
          onClick={() => setDeleteTarget(role)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    ));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text-primary">
          {localize('com_admin_unused_roles_title')}
        </h2>
        <Button variant="outline" type="button" onClick={() => navigate('/admin/access')}>
          {localize('com_admin_unused_roles_back')}
        </Button>
      </div>

      {renderBody()}

      {deleteTarget ? (
        <DeleteConfirmDialog
          roleKey={deleteTarget.roleKey}
          roleName={deleteTarget.name}
          open={true}
          onOpenChange={(value) => {
            if (!value) {
              setDeleteTarget(null);
            }
          }}
          onDeleted={() => setDeleteTarget(null)}
          deleteMsg={localize('com_admin_access_delete_confirm', { 0: deleteTarget.name })}
        />
      ) : null}
    </div>
  );
}
