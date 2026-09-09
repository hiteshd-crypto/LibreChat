import { useEffect, useState } from 'react';
import { OGDialog, OGDialogTemplate, Button, Spinner } from '@librechat/client';
import type { TAdminRole } from 'librechat-data-provider';
import { descendantKeys, reparentBlock } from './reparent';
import { useSetRoleParent } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { useLocalize } from '~/hooks';

export interface MoveIntent {
  role: TAdminRole;
  /** Preset from a drop; unset when opened via the keyboard handle (user picks below). */
  newParentKey?: string;
}

export default function MoveRoleDialog({
  move,
  roles,
  labelMap,
  onClose,
}: {
  move: MoveIntent | null;
  roles: TAdminRole[];
  labelMap: Map<string, string>;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const mutation = useSetRoleParent();
  const [picked, setPicked] = useState('');

  const moveRoleKey = move?.role.roleKey;
  useEffect(() => {
    setPicked('');
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveRoleKey]);

  if (!move) {
    return null;
  }

  const label = (key: string) => labelMap.get(key) ?? key;
  const targetKey = move.newParentKey ?? picked;
  const subtreeSize = descendantKeys(roles, move.role.roleKey).size;
  const options = move.newParentKey
    ? []
    : roles.filter((r) => reparentBlock(roles, move.role.roleKey, r.roleKey) === null);

  const confirm = () => {
    if (!targetKey) {
      return;
    }
    mutation.mutate(
      { roleKey: move.role.roleKey, parentRole: targetKey },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <OGDialog
      open
      onOpenChange={(value) => {
        if (!value) {
          setPicked('');
          mutation.reset();
          onClose();
        }
      }}
    >
      <OGDialogTemplate
        title={localize('com_admin_role_action_move')}
        showCloseButton={false}
        className="w-11/12 md:max-w-md"
        main={
          <div className="flex flex-col gap-3">
            {move.newParentKey ? (
              <p className="text-sm text-text-primary">
                {subtreeSize > 0
                  ? localize('com_admin_role_move_confirm_subtree', {
                      0: label(move.role.roleKey),
                      1: label(targetKey),
                      2: String(subtreeSize),
                    })
                  : localize('com_admin_role_move_confirm', {
                      0: label(move.role.roleKey),
                      1: label(targetKey),
                    })}
              </p>
            ) : (
              <label className="flex flex-col gap-1 text-sm text-text-secondary">
                {localize('com_admin_role_parent_label')}
                <select
                  className="rounded-lg border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-text-primary"
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  <option value="">—</option>
                  {options.map((r) => (
                    <option key={r.roleKey} value={r.roleKey}>
                      {label(r.roleKey)}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            disabled={mutation.isLoading || !targetKey}
            onClick={confirm}
          >
            {mutation.isLoading ? <Spinner /> : localize('com_ui_confirm')}
          </Button>
        }
      />
    </OGDialog>
  );
}
