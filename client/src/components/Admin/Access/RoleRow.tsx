import { Trash2 } from 'lucide-react';
import type { TAdminRole } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

export default function RoleRow({
  role,
  isSystem,
  onEdit,
  onDelete,
}: {
  role: TAdminRole;
  isSystem: boolean;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const localize = useLocalize();
  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-3">
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 rounded text-left outline-none focus-visible:outline-1"
      >
        <span className="text-sm font-medium text-text-primary hover:underline">{role.name}</span>
        {isSystem ? (
          <span className="ml-2 rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            {localize('com_admin_access_system_badge')}
          </span>
        ) : null}
        {role.description ? (
          <div className="truncate text-xs text-text-secondary">{role.description}</div>
        ) : null}
      </button>
      {onDelete && !isSystem ? (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`${localize('com_ui_delete')} ${role.name}`}
          className="text-text-secondary hover:text-text-primary"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
