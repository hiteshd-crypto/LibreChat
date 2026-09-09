import { GripVertical, Plus, Pencil } from 'lucide-react';
import type { TAdminRole } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

export default function RoleRow({
  role,
  isSystem,
  isTopLevel,
  label,
  onEdit,
  onAdd,
  onKeyboardMove,
  dragHandleRef,
  isDragging = false,
}: {
  role: TAdminRole;
  isSystem: boolean;
  /** Top-level roles (branch roots) get no drag handle — a branch cannot be moved. */
  isTopLevel: boolean;
  label: string;
  onEdit: () => void;
  onAdd: () => void;
  onKeyboardMove: () => void;
  dragHandleRef?: (el: HTMLButtonElement | null) => void;
  isDragging?: boolean;
}) {
  const localize = useLocalize();
  const showGrip = !isSystem && !isTopLevel;
  const showAdd = !isSystem;

  return (
    <div
      data-role-key={role.roleKey}
      className={`mb-2 flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left ${
        isDragging
          ? 'border-ring-primary bg-surface-active ring-2 ring-ring-primary'
          : 'border-border-light bg-surface-secondary'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        {isSystem ? (
          <span className="ml-2 rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            {localize('com_admin_access_system_badge')}
          </span>
        ) : null}
        {role.description ? (
          <span className="block truncate text-xs text-text-secondary">{role.description}</span>
        ) : null}
      </span>

      {showGrip ? (
        <button
          type="button"
          ref={dragHandleRef}
          title={localize('com_admin_role_action_move')}
          aria-label={localize('com_admin_role_action_move')}
          className="shrink-0 cursor-grab text-text-secondary hover:text-text-primary"
          onClick={onKeyboardMove}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {showAdd ? (
        <button
          type="button"
          title={localize('com_admin_role_action_add')}
          aria-label={localize('com_admin_role_action_add')}
          className="shrink-0 text-text-secondary hover:text-text-primary"
          onClick={onAdd}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        title={localize('com_admin_role_action_edit')}
        aria-label={localize('com_admin_role_action_edit')}
        className="shrink-0 text-text-secondary hover:text-text-primary"
        onClick={onEdit}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
