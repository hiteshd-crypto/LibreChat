import { useSetUserRole } from '~/data-provider';
import { useLocalize } from '~/hooks';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role?: string;
  provider?: string;
  createdAt?: string;
}

export default function UserRow({
  user,
  locale,
  onOpen,
  manageableRoleKeys,
  roleLabel,
}: {
  user: AdminUserRow;
  locale: string;
  onOpen: () => void;
  /** Present only for a non-admin viewer with subordinate-management access;
   *  renders a "Change role" select in place of the plain role badge. Values are roleKeys. */
  manageableRoleKeys?: string[];
  /** Maps a roleKey to a display label; defaults to the key itself. */
  roleLabel?: (roleKey: string) => string;
}) {
  const localize = useLocalize();
  const setUserRole = useSetUserRole();
  const label = roleLabel ?? ((key: string) => key);
  const created = user.createdAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(user.createdAt))
    : '—';
  const canManageRole = manageableRoleKeys != null && manageableRoleKeys.length > 0;

  const roleCell = canManageRole ? (
    <select
      aria-label={localize('com_admin_users_change_role')}
      className="rounded-lg border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary"
      value={user.role ?? ''}
      disabled={setUserRole.isLoading}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setUserRole.mutate({ userId: user.id, role: e.target.value })}
    >
      {user.role && !manageableRoleKeys?.includes(user.role) ? (
        <option value={user.role}>{label(user.role)}</option>
      ) : null}
      {manageableRoleKeys?.map((roleKey) => (
        <option key={roleKey} value={roleKey}>
          {label(roleKey)}
        </option>
      ))}
    </select>
  ) : null;

  const roleBadge =
    !canManageRole && user.role ? (
      <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
        {label(user.role)}
      </span>
    ) : null;

  return (
    <tr
      className="cursor-pointer border-b border-border-light hover:bg-surface-hover"
      onClick={onOpen}
    >
      <td className="px-3 py-2 text-sm text-text-primary">{user.name || user.email}</td>
      <td className="px-3 py-2 text-sm text-text-secondary">{user.email}</td>
      <td className="px-3 py-2">
        {roleCell}
        {roleBadge}
      </td>
      <td className="px-3 py-2 text-sm text-text-secondary">{user.provider ?? '—'}</td>
      <td className="px-3 py-2 text-sm text-text-secondary">
        <span className="sr-only">{localize('com_admin_users_col_created')}: </span>
        {created}
      </td>
    </tr>
  );
}
