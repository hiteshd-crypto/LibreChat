import { useMemo, useState } from 'react';
import { ControlCombobox, Label, Spinner } from '@librechat/client';
import { useMyDepartmentMembers } from '~/data-provider';
import BalanceViewer from './BalanceViewer';
import { useLocalize } from '~/hooks';

const COMBOBOX_ID = 'admin-balance-department-user';

/** Department Head's "User Balance" page — same picker shell as the Super Admin's
 * `BalanceView.tsx`, but the user list is scoped to the caller's own department
 * (via `useMyDepartmentMembers`, which already includes the Head themselves), and
 * the selected balance is rendered read-only via `BalanceViewer`, never `BalanceEditor`. */
export default function DepartmentBalanceView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useMyDepartmentMembers();
  const [userId, setUserId] = useState('');

  const memberById = useMemo(
    () => new Map((data?.members ?? []).map((member) => [member.userId, member])),
    [data],
  );
  const items = useMemo(
    () =>
      (data?.members ?? []).map((member) => ({
        label: `${member.name} (${member.email})`,
        value: member.userId,
      })),
    [data],
  );

  if (isLoading) {
    return (
      <div data-testid="admin-balance-department-loading" className="flex justify-center py-10">
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

  const selected = memberById.get(userId);

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
              displayValue={selected ? `${selected.name} (${selected.email})` : ''}
              items={items}
              setValue={setUserId}
              ariaLabel={localize('com_admin_balance_user_label')}
              searchPlaceholder={localize('com_admin_balance_user_search')}
              selectPlaceholder={localize('com_admin_balance_user_placeholder')}
              isCollapsed={false}
              showCarat={true}
              variant="field"
            />
          </div>
          {selected ? <BalanceViewer key={selected.userId} userId={selected.userId} /> : null}
        </div>
      )}

      {!selected && items.length > 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_balance_select_prompt')}</p>
      ) : null}
    </div>
  );
}
