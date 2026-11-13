import { useMemo, useState } from 'react';
import { OGDialog, OGDialogTemplate, Button, Spinner } from '@librechat/client';
import type { TAdminRole } from 'librechat-data-provider';
import { useAdminRoles, useDepartments, useSetDepartmentHead } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { SYSTEM_ROLES } from './constants';
import { useLocalize } from '~/hooks';

/**
 * The counterpart to the top-level "Create role" dialog's departmentId-linking
 * path: lets the Super Admin wrap an existing, still-unclaimed top-level role
 * (one created earlier, or reparented up via drag-and-drop) as an empty
 * department's head, instead of only being able to mint a brand-new role at
 * the moment the department is created.
 */
export default function SetDepartmentHeadDialog({
  open,
  onOpenChange,
  departmentId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  departmentId: string;
}) {
  const localize = useLocalize();
  const { data: rolesData, isLoading: rolesLoading } = useAdminRoles();
  const { data: departmentsData, isLoading: departmentsLoading } = useDepartments();
  const [selected, setSelected] = useState<string | null>(null);
  const mutation = useSetDepartmentHead();

  const claimedRoleKeys = useMemo(
    () =>
      new Set(
        (departmentsData?.departments ?? [])
          .map((department) => department.rootRoleKey)
          .filter((key): key is string => key != null),
      ),
    [departmentsData?.departments],
  );

  const eligibleRoles = useMemo(
    () =>
      (rolesData?.roles ?? []).filter(
        (role: TAdminRole) =>
          role.parentRole == null &&
          !SYSTEM_ROLES.has(role.name) &&
          !claimedRoleKeys.has(role.roleKey),
      ),
    [rolesData?.roles, claimedRoleKeys],
  );

  const reset = () => {
    setSelected(null);
    mutation.reset();
  };

  const submit = () => {
    if (!selected) {
      return;
    }
    mutation.mutate(
      { departmentId, body: { roleKey: selected } },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  const isLoading = rolesLoading || departmentsLoading;

  const renderRoleList = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      );
    }
    if (eligibleRoles.length === 0) {
      return (
        <p className="text-sm text-text-secondary">
          {localize('com_admin_department_set_head_empty')}
        </p>
      );
    }
    return (
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {eligibleRoles.map((role: TAdminRole) => (
          <li key={role.roleKey}>
            <button
              type="button"
              onClick={() => setSelected(role.roleKey)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                selected === role.roleKey
                  ? 'border-ring-primary bg-surface-active text-text-primary'
                  : 'border-border-light bg-surface-secondary text-text-primary hover:bg-surface-hover'
              }`}
            >
              <span className="font-medium">{role.name}</span>
              {role.description ? (
                <span className="block truncate text-xs text-text-secondary">
                  {role.description}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <OGDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          reset();
        }
        onOpenChange(value);
      }}
    >
      <OGDialogTemplate
        title={localize('com_admin_department_set_head_title')}
        showCloseButton={false}
        className="w-11/12 md:max-w-md"
        main={
          <div className="flex flex-col gap-3">
            {renderRoleList()}
            {mutation.error ? (
              <p role="alert" className="text-sm text-text-destructive">
                {getResponseErrorMessage(mutation.error)}
              </p>
            ) : null}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            type="button"
            disabled={mutation.isLoading || !selected}
            onClick={submit}
          >
            {mutation.isLoading ? <Spinner /> : localize('com_admin_department_set_head_submit')}
          </Button>
        }
      />
    </OGDialog>
  );
}
