import { useMemo, useState } from 'react';
import { Button, ControlCombobox, Input, Label, Spinner, useToastContext } from '@librechat/client';
import type { TAdminUserListItem, TTokenGrantPreviewResponse } from 'librechat-data-provider';
import {
  useTokenGrantPreview,
  useTokenGrantConfirm,
  getTokenGrantStaleError,
} from '~/data-provider/Admin/mutations';
import { useAdminTokenGrantDescendants } from '~/data-provider/Admin/queries';
import { useAdminAllUsers } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { NotificationSeverity } from '~/common';
import { parseRate } from '../Pricing/rates';
import { useLocalize } from '~/hooks';

const userLabel = (user: TAdminUserListItem): string =>
  user.name ? `${user.name} (${user.email})` : user.email;

export default function GrantDialog() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, isLoading, isError } = useAdminAllUsers();

  const [rootUserId, setRootUserId] = useState('');
  const [recipientIds, setRecipientIds] = useState<string[]>(['']);
  const [amountDraft, setAmountDraft] = useState('');
  const [preview, setPreview] = useState<TTokenGrantPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const descendants = useAdminTokenGrantDescendants(rootUserId);
  const previewGrant = useTokenGrantPreview();
  const confirmGrant = useTokenGrantConfirm();

  const usersById = useMemo(
    () => new Map((data?.users ?? []).map((user) => [user.id, user])),
    [data],
  );
  const descendantItems = useMemo(
    () =>
      (descendants.data?.descendants ?? []).map((d) => ({
        label: d.name ? `${d.name} (${d.email})` : d.email,
        value: d.userId,
      })),
    [descendants.data],
  );
  const descendantNameById = useMemo(
    () => new Map((descendants.data?.descendants ?? []).map((d) => [d.userId, d.name || d.email])),
    [descendants.data],
  );

  const selectedRecipientIds = useMemo(() => new Set(recipientIds.filter(Boolean)), [recipientIds]);
  const itemsExcluding = (currentValue: string) =>
    descendantItems.filter(
      (item) => item.value === currentValue || !selectedRecipientIds.has(item.value),
    );

  const totalAmount = parseRate(amountDraft);
  const hasNoDescendants = !!rootUserId && !descendants.isLoading && descendantItems.length === 0;

  const changeRoot = (value: string) => {
    setRootUserId(value);
    setRecipientIds(['']);
    setPreview(null);
    setError(null);
  };
  const updateRecipient = (index: number, value: string) => {
    setRecipientIds((prev) => prev.map((id, i) => (i === index ? value : id)));
    setPreview(null);
  };
  const removeRecipient = (index: number) => {
    setRecipientIds((prev) => prev.filter((_, i) => i !== index));
    setPreview(null);
  };
  const addRecipient = () => setRecipientIds((prev) => [...prev, '']);
  const changeAmount = (value: string) => {
    setAmountDraft(value);
    setPreview(null);
  };

  const resetForm = () => {
    setRootUserId('');
    setRecipientIds(['']);
    setAmountDraft('');
    setPreview(null);
    setError(null);
  };

  const runPreview = () => {
    if (!rootUserId) {
      setError(localize('com_admin_token_grant_root_required'));
      return;
    }
    if (totalAmount == null || totalAmount <= 0) {
      setError(localize('com_admin_token_grant_invalid_amount'));
      return;
    }
    setError(null);
    previewGrant.mutate(
      { rootUserId, recipientUserIds: Array.from(selectedRecipientIds), totalAmount },
      {
        onSuccess: (response) => setPreview(response),
        onError: (err) => {
          setPreview(null);
          setError(getResponseErrorMessage(err, localize('com_admin_token_grant_error')));
        },
      },
    );
  };

  const runConfirm = () => {
    if (!preview || totalAmount == null) {
      return;
    }
    const expectedBalances = Object.fromEntries(
      preview.rows.map((row) => [row.userId, row.currentBalance]),
    );
    confirmGrant.mutate(
      {
        rootUserId,
        recipientUserIds: Array.from(selectedRecipientIds),
        totalAmount,
        expectedBalances,
      },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_admin_token_grant_saved'),
            severity: NotificationSeverity.SUCCESS,
          });
          resetForm();
        },
        onError: (err) => {
          const stale = getTokenGrantStaleError(err);
          setPreview(null);
          if (stale) {
            setError(
              localize('com_admin_token_grant_stale_error', {
                0: stale.map((s) => s.userId).join(', '),
              }),
            );
            return;
          }
          showToast({
            message: getResponseErrorMessage(err, localize('com_admin_token_grant_error')),
            severity: NotificationSeverity.ERROR,
          });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-text-primary">
          {localize('com_admin_token_grant_title')}
        </h3>
        <p className="text-sm text-text-secondary">{localize('com_admin_token_grant_hint')}</p>
      </div>

      <div className="flex flex-col gap-1 md:max-w-sm">
        <Label variant="section">{localize('com_admin_token_grant_root_label')}</Label>
        <ControlCombobox
          selectId="token-grant-root"
          selectedValue={rootUserId}
          displayValue={rootUserId ? userLabel(usersById.get(rootUserId)!) : ''}
          items={(data.users ?? []).map((user) => ({ label: userLabel(user), value: user.id }))}
          setValue={changeRoot}
          ariaLabel={localize('com_admin_token_grant_root_label')}
          searchPlaceholder={localize('com_admin_balance_user_search')}
          selectPlaceholder={localize('com_admin_balance_user_placeholder')}
          isCollapsed={false}
          showCarat={true}
          variant="field"
        />
      </div>

      {rootUserId && hasNoDescendants ? (
        <p role="status" className="text-sm text-text-secondary">
          {localize('com_admin_token_grant_no_descendants')}
        </p>
      ) : null}

      {rootUserId && !hasNoDescendants ? (
        <div className="flex flex-col gap-2">
          <Label variant="section">{localize('com_admin_token_grant_subordinates_label')}</Label>
          {descendants.isLoading ? (
            <Spinner />
          ) : (
            <>
              {recipientIds.map((id, index) => (
                <div key={index} className="flex items-center gap-2 md:max-w-sm">
                  <ControlCombobox
                    selectId={`token-grant-recipient-${index}`}
                    selectedValue={id}
                    displayValue={id ? (descendantNameById.get(id) ?? '') : ''}
                    items={itemsExcluding(id)}
                    setValue={(value) => updateRecipient(index, value)}
                    ariaLabel={localize('com_admin_token_grant_subordinates_label')}
                    searchPlaceholder={localize('com_admin_balance_user_search')}
                    selectPlaceholder={localize('com_admin_balance_user_placeholder')}
                    isCollapsed={false}
                    showCarat={true}
                    variant="field"
                  />
                  <Button variant="outline" type="button" onClick={() => removeRecipient(index)}>
                    {localize('com_ui_delete')}
                  </Button>
                </div>
              ))}
              <Button variant="outline" type="button" className="self-start" onClick={addRecipient}>
                {localize('com_admin_token_grant_add_recipient')}
              </Button>
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-1 md:max-w-xs">
        <Label htmlFor="token-grant-amount" variant="section">
          {localize('com_admin_token_grant_amount_label')}
        </Label>
        <Input
          id="token-grant-amount"
          inputMode="decimal"
          value={amountDraft}
          onChange={(e) => changeAmount(e.target.value)}
          disabled={previewGrant.isLoading || confirmGrant.isLoading}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-text-destructive">
          {error}
        </p>
      ) : null}

      {preview ? (
        <table className="w-auto border-collapse self-start overflow-hidden rounded-md border border-border-light text-sm text-text-primary">
          <thead>
            <tr className="bg-surface-secondary text-left text-text-secondary">
              <th className="border-b border-r border-border-light px-3 py-1.5">
                {localize('com_admin_token_grant_preview_header_name')}
              </th>
              <th className="border-b border-r border-border-light px-3 py-1.5">
                {localize('com_admin_token_grant_preview_header_current')}
              </th>
              <th className="border-b border-border-light px-3 py-1.5">
                {localize('com_admin_token_grant_preview_header_new')}
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.userId} className="border-b border-border-light last:border-b-0">
                <td className="border-r border-border-light px-3 py-1.5">{row.name}</td>
                <td className="border-r border-border-light px-3 py-1.5">
                  {row.currentBalance?.toFixed(2)}
                </td>
                <td className="px-3 py-1.5">{row.newBalance?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="flex gap-2 self-start">
        {preview ? (
          <Button
            variant="submit"
            type="button"
            disabled={confirmGrant.isLoading}
            onClick={runConfirm}
          >
            {confirmGrant.isLoading ? (
              <Spinner />
            ) : (
              localize('com_admin_token_grant_confirm_submit')
            )}
          </Button>
        ) : (
          <Button
            variant="submit"
            type="button"
            disabled={previewGrant.isLoading || hasNoDescendants}
            onClick={runPreview}
          >
            {previewGrant.isLoading ? <Spinner /> : localize('com_admin_token_grant_submit')}
          </Button>
        )}
      </div>
    </div>
  );
}
