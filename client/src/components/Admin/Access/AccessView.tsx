import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Spinner } from '@librechat/client';
import type { TAdminRole } from 'librechat-data-provider';
import CreateRoleDialog from './CreateRoleDialog';
import { useAdminRoles } from '~/data-provider';
import EditRoleDialog from './EditRoleDialog';
import { SYSTEM_ROLES } from './constants';
import { useLocalize } from '~/hooks';
import RoleRow from './RoleRow';

export default function AccessView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useAdminRoles();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TAdminRole | null>(null);

  const roles = useMemo(() => {
    const list = data?.roles ?? [];
    const q = search.trim().toLowerCase();
    return q ? list.filter((r) => r.name.toLowerCase().includes(q)) : list;
  }, [data?.roles, search]);

  if (isLoading) {
    return (
      <div data-testid="admin-roles-loading" className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-text-secondary">{localize('com_admin_access_load_error')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={localize('com_admin_access_search_placeholder')}
          className="max-w-xs"
        />
        <Button variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {localize('com_admin_access_create_role')}
        </Button>
      </div>

      {roles.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_access_empty')}</p>
      ) : (
        roles.map((role) => (
          <RoleRow
            key={role.name}
            role={role}
            isSystem={SYSTEM_ROLES.has(role.name)}
            onEdit={() => setEditTarget(role)}
          />
        ))
      )}

      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditRoleDialog role={editTarget} onClose={() => setEditTarget(null)} />
    </div>
  );
}
