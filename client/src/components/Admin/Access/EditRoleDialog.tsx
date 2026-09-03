import { useEffect, useState } from 'react';
import { SystemRoles } from 'librechat-data-provider';
import {
  OGDialog,
  OGDialogTemplate,
  Button,
  Input,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@librechat/client';
import type { TAdminRole } from 'librechat-data-provider';
import { useUpdateRole, useDeleteRole } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import RoleMembersPanel from './RoleMembersPanel';
import { SYSTEM_ROLES } from './constants';
import { useLocalize } from '~/hooks';

export default function EditRoleDialog({
  role,
  onClose,
}: {
  role: TAdminRole | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateMutation = useUpdateRole();
  const deleteMutation = useDeleteRole();

  useEffect(() => {
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setConfirmDelete(false);
    updateMutation.reset();
    deleteMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role?.name]);

  if (!role) {
    return null;
  }

  const isSystem = SYSTEM_ROLES.has(role.name);
  /** USER is the implicit baseline — the backend rejects membership ops on it. */
  const canManageMembers = role.name !== SystemRoles.USER;
  const mutationError = updateMutation.error ?? deleteMutation.error;
  const error = mutationError ? getResponseErrorMessage(mutationError) : undefined;

  const saveDetails = () => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    updateMutation.mutate(
      {
        name: role.name,
        updates: {
          name: trimmedName && trimmedName !== role.name ? trimmedName : undefined,
          // Send the empty string (not undefined) so an existing description can be cleared.
          description:
            trimmedDescription !== (role.description ?? '') ? trimmedDescription : undefined,
        },
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <OGDialog open={role != null} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <OGDialogTemplate
        title={localize('com_admin_access_edit_title')}
        showCloseButton={false}
        className="w-11/12 md:max-w-lg"
        main={
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">{localize('com_admin_access_tab_details')}</TabsTrigger>
              {canManageMembers ? (
                <TabsTrigger value="members">
                  {localize('com_admin_access_tab_members')}
                </TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="details" className="flex flex-col gap-3 p-0 pt-3">
              {!canManageMembers ? (
                <p className="text-xs text-text-secondary">
                  {localize('com_admin_access_user_role_note')}
                </p>
              ) : null}
              <label className="flex flex-col gap-1 text-sm text-text-secondary">
                {localize('com_admin_access_role_name')}
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isSystem} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-text-secondary">
                {localize('com_admin_access_role_description')}
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              {error ? <p className="text-sm text-text-secondary">{error}</p> : null}
              <div className="flex items-center justify-between">
                <Button
                  variant="submit"
                  type="button"
                  disabled={updateMutation.isLoading}
                  onClick={saveDetails}
                >
                  {updateMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
                </Button>
                {!isSystem && !confirmDelete ? (
                  <Button variant="outline" type="button" onClick={() => setConfirmDelete(true)}>
                    {localize('com_ui_delete')}
                  </Button>
                ) : null}
                {!isSystem && confirmDelete ? (
                  <Button
                    variant="destructive"
                    type="button"
                    disabled={deleteMutation.isLoading}
                    onClick={() =>
                      deleteMutation.mutate({ name: role.name }, { onSuccess: () => onClose() })
                    }
                  >
                    {deleteMutation.isLoading ? (
                      <Spinner />
                    ) : (
                      localize('com_admin_access_delete_confirm', { 0: role.name })
                    )}
                  </Button>
                ) : null}
              </div>
            </TabsContent>

            {canManageMembers ? (
              <TabsContent value="members" className="p-0 pt-3">
                <RoleMembersPanel roleName={role.name} />
              </TabsContent>
            ) : null}
          </Tabs>
        }
      />
    </OGDialog>
  );
}
