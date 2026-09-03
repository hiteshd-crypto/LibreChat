import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input, Spinner } from '@librechat/client';
import type { ReactNode } from 'react';
import type { AdminUserRow } from './UserRow';
import { useAdminUsers, useAdminUserSearch } from '~/data-provider';
import { useLocalize } from '~/hooks';
import UserRow from './UserRow';

const SEARCH_DEBOUNCE_MS = 300;

export default function UsersView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  const isSearching = search.trim().length >= 2;
  const listQuery = useAdminUsers(page, { enabled: !isSearching });
  const searchQuery = useAdminUserSearch(search);

  const rows: AdminUserRow[] = useMemo(() => {
    if (isSearching) {
      return (searchQuery.data?.users ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
      }));
    }
    return (listQuery.data?.users ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      provider: u.provider,
      createdAt: u.createdAt,
    }));
  }, [isSearching, searchQuery.data, listQuery.data]);

  const isLoading = isSearching ? searchQuery.isLoading : listQuery.isLoading;
  const isError = isSearching ? searchQuery.isError : listQuery.isError;
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  const open = (user: AdminUserRow) =>
    navigate(`/admin/users/${encodeURIComponent(user.id)}`, { state: { name: user.name } });

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  } else if (isError) {
    body = <p className="text-sm text-text-secondary">{localize('com_admin_users_load_error')}</p>;
  } else if (rows.length === 0) {
    body = <p className="text-sm text-text-secondary">{localize('com_admin_users_empty')}</p>;
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-text-secondary">{localize('com_admin_users_list_hint')}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-light text-left text-xs text-text-secondary">
                <th className="px-3 py-2 font-medium">{localize('com_admin_users_col_name')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_admin_users_col_email')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_admin_users_col_role')}</th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_admin_users_col_provider')}
                </th>
                <th className="px-3 py-2 font-medium">{localize('com_admin_users_col_created')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <UserRow key={user.id} user={user} locale={locale} onOpen={() => open(user)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder={localize('com_admin_users_search_placeholder')}
        className="max-w-xs"
      />

      {body}

      {!isSearching && totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-text-secondary">
          <button
            type="button"
            disabled={page <= 1}
            className="disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {localize('com_admin_access_page_prev')}
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            className="disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {localize('com_admin_access_page_next')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
