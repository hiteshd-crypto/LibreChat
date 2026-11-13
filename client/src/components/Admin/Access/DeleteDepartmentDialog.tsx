import { OGDialog, OGDialogTemplate, Button, Spinner, useToastContext } from '@librechat/client';
import type { TDepartment } from 'librechat-data-provider';
import { useDeleteDepartment } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

export default function DeleteDepartmentDialog({
  department,
  onClose,
}: {
  department: TDepartment | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const mutation = useDeleteDepartment();

  if (!department) {
    return null;
  }

  const memberCount = department.memberCount ?? 0;
  const confirmMessage =
    memberCount > 0
      ? localize('com_admin_department_delete_confirm_members', {
          0: department.name,
          1: memberCount,
        })
      : localize('com_admin_department_delete_confirm', { 0: department.name });

  const handleConfirm = () =>
    mutation.mutate(
      { departmentId: department._id },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_admin_department_deleted', { 0: department.name }),
            severity: NotificationSeverity.SUCCESS,
          });
          onClose();
        },
      },
    );

  return (
    <OGDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isLoading) {
          onClose();
        }
      }}
    >
      <OGDialogTemplate
        title={localize('com_admin_department_delete')}
        className="w-11/12 md:max-w-md"
        main={
          <p role={mutation.error ? 'alert' : undefined} className="text-sm text-text-secondary">
            {mutation.error ? getResponseErrorMessage(mutation.error) : confirmMessage}
          </p>
        }
        buttons={
          <Button
            variant="destructive"
            type="button"
            disabled={mutation.isLoading}
            onClick={handleConfirm}
          >
            {mutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
          </Button>
        }
      />
    </OGDialog>
  );
}
