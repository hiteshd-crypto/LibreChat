import { OGDialog, OGDialogTemplate, Button, Spinner, useToastContext } from '@librechat/client';
import type { TAdminPricingRate } from 'librechat-data-provider';
import { useDeletePricingRate } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

export default function DeleteRateDialog({
  rate,
  onClose,
}: {
  rate: TAdminPricingRate | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const deleteMutation = useDeletePricingRate();

  if (!rate) {
    return null;
  }

  const handleConfirm = () =>
    deleteMutation.mutate(
      { modelKey: rate.modelKey },
      {
        onSuccess: (result) => {
          showToast({
            message: result.cacheReloaded
              ? localize('com_admin_pricing_deleted', { 0: rate.modelKey })
              : localize('com_admin_pricing_cache_warning'),
            severity: result.cacheReloaded
              ? NotificationSeverity.SUCCESS
              : NotificationSeverity.WARNING,
          });
          onClose();
        },
      },
    );

  return (
    <OGDialog
      open
      onOpenChange={(open) => {
        if (!open && !deleteMutation.isLoading) {
          onClose();
        }
      }}
    >
      <OGDialogTemplate
        title={localize('com_admin_pricing_delete_title', { 0: rate.modelKey })}
        className="w-11/12 md:max-w-md"
        main={
          <p
            role={deleteMutation.error ? 'alert' : undefined}
            className="text-sm text-text-secondary"
          >
            {deleteMutation.error
              ? getResponseErrorMessage(
                  deleteMutation.error,
                  localize('com_admin_pricing_delete_error'),
                )
              : localize('com_admin_pricing_delete_confirm', { 0: rate.modelKey })}
          </p>
        }
        buttons={
          <Button
            variant="destructive"
            type="button"
            disabled={deleteMutation.isLoading}
            onClick={handleConfirm}
          >
            {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
          </Button>
        }
      />
    </OGDialog>
  );
}
