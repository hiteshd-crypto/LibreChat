import { useEffect, useState } from 'react';
import {
  OGDialog,
  OGDialogTemplate,
  Button,
  Input,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TDepartment } from 'librechat-data-provider';
import { useRenameDepartment } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

export default function RenameDepartmentDialog({
  department,
  onClose,
}: {
  department: TDepartment | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [name, setName] = useState('');
  const mutation = useRenameDepartment();

  useEffect(() => {
    setName(department?.name ?? '');
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department?._id]);

  if (!department) {
    return null;
  }

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || trimmed === department.name) {
      onClose();
      return;
    }
    mutation.mutate(
      { departmentId: department._id, body: { name: trimmed } },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_admin_department_renamed', { 0: trimmed }),
            severity: NotificationSeverity.SUCCESS,
          });
          onClose();
        },
      },
    );
  };

  return (
    <OGDialog open onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <OGDialogTemplate
        title={localize('com_admin_department_rename')}
        showCloseButton={false}
        className="w-11/12 md:max-w-md"
        main={
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_access_role_name')}
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {mutation.error ? (
              <p role="alert" className="text-sm text-text-secondary">
                {getResponseErrorMessage(mutation.error)}
              </p>
            ) : null}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            type="button"
            disabled={mutation.isLoading || !trimmed}
            onClick={submit}
          >
            {mutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
