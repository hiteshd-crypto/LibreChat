import { useState } from 'react';
import { OGDialog, OGDialogTemplate, Button, Input, Spinner } from '@librechat/client';
import type { TAdminRole } from 'librechat-data-provider';
import { getResponseErrorMessage } from '~/utils';
import { useCreateRole } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function CreateRoleDialog({
  open,
  onOpenChange,
  parent,
  departmentId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  /** When set, the dialog adds a child of this role; otherwise it creates a top-level role. */
  parent?: TAdminRole | null;
  /** Only meaningful for a top-level create (no `parent`): claims an empty
   * department's root role and grants it DEPARTMENT_HEAD. */
  departmentId?: string;
}) {
  const localize = useLocalize();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const mutation = useCreateRole();

  const title = (() => {
    if (parent) {
      return localize('com_admin_role_add_under', { 0: parent.name });
    }
    if (departmentId) {
      return localize('com_admin_department_add_head_title');
    }
    return localize('com_admin_access_create_title');
  })();

  const reset = () => {
    setName('');
    setDescription('');
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
        parentRole: parent?.roleKey ?? null,
        departmentId: parent ? undefined : departmentId,
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
        title={title}
        showCloseButton={false}
        className="w-11/12 md:max-w-md"
        main={
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_access_role_name')}
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={localize('com_admin_access_role_name_placeholder')}
              />
            </label>
            <p className="-mt-2 text-xs text-text-secondary">
              {localize('com_admin_access_role_name_hint')}
            </p>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_access_role_description')}
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <p className="text-xs text-text-secondary">
              {localize('com_admin_access_role_members_hint')}
            </p>
            {parent ? (
              <p className="text-sm text-text-secondary">
                {localize('com_admin_role_parent_label')}:{' '}
                <span className="text-text-primary">{parent.name}</span>
              </p>
            ) : null}
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
