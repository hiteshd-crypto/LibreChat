import { OGDialog, OGDialogTemplate, Button, Spinner } from '@librechat/client';
import { getResponseErrorMessage } from '~/utils';
import { useDeleteRole } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function DeleteConfirmDialog({
  roleKey,
  roleName,
  open,
  onOpenChange,
  onDeleted,
  deleteMsg,
}: {
  roleKey: string;
  roleName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
  deleteMsg: string;
}) {
  const localize = useLocalize();
  const deleteMutation = useDeleteRole();

  const handleConfirm = () => {
    deleteMutation.mutate(
      { roleKey },
      {
        onSuccess: () => {
          onOpenChange(false);
          onDeleted();
        },
      },
    );
  };

  return (
    <OGDialog
      open={open}
      onOpenChange={(value) => {
        if (!deleteMutation.isLoading) {
          onOpenChange(value);
        }
      }}
    >
      <OGDialogTemplate
        title={localize('com_ui_delete', { 0: roleName })}
        className="w-11/12 md:max-w-md"
        main={
          <div className="flex flex-col gap-3">
            {deleteMutation.error ? (
              <p className="text-sm text-text-secondary">
                {getResponseErrorMessage(deleteMutation.error)}
              </p>
            ) : (
              <p className="text-sm text-text-secondary">{deleteMsg}</p>
            )}
          </div>
        }
        buttons={
          <>
            <Button
              variant="destructive"
              type="button"
              disabled={deleteMutation.isLoading}
              onClick={handleConfirm}
            >
              {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
            </Button>
          </>
        }
      />
    </OGDialog>
  );
}
