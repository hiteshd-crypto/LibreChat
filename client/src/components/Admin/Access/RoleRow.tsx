import { ChevronRight } from 'lucide-react';
import type { TAdminRole } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

export default function RoleRow({
  role,
  isSystem,
  onEdit,
}: {
  role: TAdminRole;
  isSystem: boolean;
  onEdit: () => void;
}) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      onClick={onEdit}
      className="mb-2 flex w-full items-center gap-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-3 text-left outline-none hover:bg-surface-hover focus-visible:outline-1"
    >
      <span className="min-w-0 flex-1">
        <span className="text-sm font-medium text-text-primary">{role.name}</span>
        {isSystem ? (
          <span className="ml-2 rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            {localize('com_admin_access_system_badge')}
          </span>
        ) : null}
        {role.description ? (
          <span className="block truncate text-xs text-text-secondary">{role.description}</span>
        ) : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
    </button>
  );
}
