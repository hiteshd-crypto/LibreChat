import { useState } from 'react';
import { OGDialog, OGDialogTemplate, Button, Input, Spinner } from '@librechat/client';
import { getResponseErrorMessage } from '~/utils';
import { useCreateRole } from '~/data-provider';
import { useLocalize } from '~/hooks';

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
  const mutation = useCreateRole();

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
      { name: name.trim(), description: description.trim() || undefined },
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
