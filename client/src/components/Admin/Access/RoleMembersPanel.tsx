import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input, Spinner, useToastContext } from '@librechat/client';
import type { ReactNode } from 'react';
import {
  useAdminRoleMembers,
  useAdminUserSearch,
  useAddRoleMember,
  useRemoveRoleMember,
  MEMBERS_PAGE_SIZE,
} from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

const SEARCH_DEBOUNCE_MS = 300;

export default function RoleMembersPanel({ roleName }: { roleName: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  const membersQuery = useAdminRoleMembers(roleName, page);
  const searchQuery = useAdminUserSearch(search);
  const addMutation = useAddRoleMember();
  const removeMutation = useRemoveRoleMember();

  const addMember = (userId: string, name: string) =>
    addMutation.mutate(
      { roleName, userId },
      {
        onSuccess: () =>
          showToast({ message: localize('com_admin_access_member_added', { 0: name }) }),
        onError: (err) =>
          showToast({
            message: getResponseErrorMessage(err, localize('com_admin_access_add_member')),
            severity: NotificationSeverity.ERROR,
          }),
      },
    );

  const removeMember = (userId: string, name: string) =>
    removeMutation.mutate(
      { roleName, userId },
      {
        onSuccess: () =>
          showToast({ message: localize('com_admin_access_member_removed', { 0: name }) }),
        onError: (err) =>
          showToast({
            message: getResponseErrorMessage(
              err,
              localize('com_admin_access_remove_member', { 0: name }),
            ),
            severity: NotificationSeverity.ERROR,
          }),
      },
    );

  const members = membersQuery.data?.members ?? [];
  const total = membersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / MEMBERS_PAGE_SIZE));
  const mutationError = addMutation.error ?? removeMutation.error;
  const error = mutationError ? getResponseErrorMessage(mutationError) : undefined;

  let memberList: ReactNode;
  if (membersQuery.isLoading) {
    memberList = (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  } else if (members.length === 0) {
    memberList = (
      <p className="text-sm text-text-secondary">{localize('com_admin_access_members_empty')}</p>
    );
  } else {
    memberList = (
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex items-center justify-between rounded-lg border border-border-light px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm text-text-primary">
              {member.name} <span className="text-text-secondary">{member.email}</span>
            </span>
            <button
              type="button"
              aria-label={localize('com_admin_access_remove_member', { 0: member.name })}
              className="text-text-secondary hover:text-text-primary"
              onClick={() => removeMember(member.userId, member.name)}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={localize('com_admin_access_search_users')}
          aria-label={localize('com_admin_access_add_member')}
        />
        {search.trim().length >= 2 && (searchQuery.data?.users.length ?? 0) > 0 ? (
          <ul className="rounded-lg border border-border-light" role="listbox">
            {searchQuery.data?.users.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
                  onClick={() => {
                    addMember(user.id, user.name);
                    setSearchInput('');
                    setSearch('');
                  }}
                >
                  {user.name} <span className="text-text-secondary">{user.email}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {memberList}

      {error ? <p className="text-sm text-text-secondary">{error}</p> : null}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-text-secondary">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {localize('com_admin_access_page_prev')}
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {localize('com_admin_access_page_next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
