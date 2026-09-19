import { useMemo, useState } from 'react';
import { ControlCombobox, Label, Spinner } from '@librechat/client';
import type { TAdminUserListItem } from 'librechat-data-provider';
import { useAdminAllUsers } from '~/data-provider';
import BalanceEditor from './BalanceEditor';
import { useLocalize } from '~/hooks';

const COMBOBOX_ID = 'admin-balance-user';

const userLabel = (user: TAdminUserListItem): string =>
  user.name ? `${user.name} (${user.email})` : user.email;

export default function BalanceView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useAdminAllUsers();
  const [userId, setUserId] = useState('');

  const usersById = useMemo(
    () => new Map((data?.users ?? []).map((user) => [user.id, user])),
    [data],
  );
  const items = useMemo(
    () => (data?.users ?? []).map((user) => ({ label: userLabel(user), value: user.id })),
    [data],
  );

  if (isLoading) {
    return (
      <div data-testid="admin-balance-users-loading" className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-text-secondary">
        {localize('com_admin_balance_users_error')}
      </p>
    );
  }

  const selected = usersById.get(userId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">
          {localize('com_admin_balance_title')}
        </h2>
        <p className="text-sm text-text-secondary">{localize('com_admin_balance_hint')}</p>
      </div>

      {items.length === 0 ? (
        <p role="status" className="text-sm text-text-secondary">
          {localize('com_admin_balance_users_empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="flex w-full flex-col md:max-w-sm">
            <Label htmlFor={COMBOBOX_ID} variant="section">
              {localize('com_admin_balance_user_label')}
            </Label>
            <ControlCombobox
              selectId={COMBOBOX_ID}
              selectedValue={userId}
              displayValue={selected ? userLabel(selected) : ''}
              items={items}
              setValue={setUserId}
              ariaLabel={localize('com_admin_balance_user_label')}
              searchPlaceholder={localize('com_admin_balance_user_search')}
              selectPlaceholder={localize('com_admin_balance_user_placeholder')}
              isCollapsed={false}
              showCarat={true}
              variant="field"
            />
            {data.truncated ? (
              <p role="status" className="mt-1 text-xs text-text-secondary">
                {localize('com_admin_balance_users_truncated', {
                  0: data.users.length,
                  1: data.total,
                })}
              </p>
            ) : null}
          </div>
          {selected ? (
            <BalanceEditor key={selected.id} userId={selected.id} userName={userLabel(selected)} />
          ) : null}
        </div>
      )}

      {!selected && items.length > 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_balance_select_prompt')}</p>
      ) : null}
    </div>
  );
}
