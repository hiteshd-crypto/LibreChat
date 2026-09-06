import { useState } from 'react';
import { OGDialog, OGDialogTemplate, Button, Input, Spinner } from '@librechat/client';
import { useCreateRole, useAdminRoles } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { SYSTEM_ROLES } from './constants';
import { useLocalize } from '~/hooks';

const TOP_LEVEL_VALUE = '';

export default function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const localize = useLocalize();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentRole, setParentRole] = useState(TOP_LEVEL_VALUE);
  const mutation = useCreateRole();
  const { data } = useAdminRoles();

  const parentOptions = (data?.roles ?? []).filter((r) => !SYSTEM_ROLES.has(r.name));

  const reset = () => {
    setName('');
    setDescription('');
    setParentRole(TOP_LEVEL_VALUE);
    mutation.reset();
  };

  const submit = () => {
    if (!name.trim()) {
      return;
    }
    mutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        parentRole: parentRole || null,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
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
        title={localize('com_admin_access_create_title')}
        showCloseButton={false}
        className="w-11/12 md:max-w-md"
        main={
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_access_role_name')}
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_access_role_description')}
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_role_parent_label')}
              <select
                className="rounded-lg border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-text-primary"
                value={parentRole}
                onChange={(e) => setParentRole(e.target.value)}
              >
                <option value={TOP_LEVEL_VALUE}>{localize('com_admin_role_top_level')}</option>
                {parentOptions.map((role) => (
                  <option key={role.name} value={role.name}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            {mutation.error ? (
              <p className="text-sm text-text-secondary">
                {getResponseErrorMessage(mutation.error)}
              </p>
            ) : null}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            type="button"
            disabled={mutation.isLoading || !name.trim()}
            onClick={submit}
          >
            {mutation.isLoading ? <Spinner /> : localize('com_ui_create')}
          </Button>
        }
      />
    </OGDialog>
  );
}
