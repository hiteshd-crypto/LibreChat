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
}: {
  user: AdminUserRow;
  locale: string;
  onOpen: () => void;
}) {
  const localize = useLocalize();
  const created = user.createdAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(user.createdAt))
    : '—';
  return (
    <tr
      className="cursor-pointer border-b border-border-light hover:bg-surface-hover"
      onClick={onOpen}
    >
      <td className="px-3 py-2 text-sm text-text-primary">{user.name || user.email}</td>
      <td className="px-3 py-2 text-sm text-text-secondary">{user.email}</td>
      <td className="px-3 py-2">
        {user.role ? (
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            {user.role}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-sm text-text-secondary">{user.provider ?? '—'}</td>
      <td className="px-3 py-2 text-sm text-text-secondary">
        <span className="sr-only">{localize('com_admin_users_col_created')}: </span>
        {created}
      </td>
    </tr>
  );
}
