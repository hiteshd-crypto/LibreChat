import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ControlCombobox, Input, Label, Spinner, useToastContext } from '@librechat/client';
import type { TDepartmentMember, TDisbursePreviewResponse } from 'librechat-data-provider';
import {
  useDisbursePreview,
  useDisburseConfirm,
  getPoolConflictError,
} from '~/data-provider/Admin/mutations';
import { getResponseErrorMessage, creditsToInr, inrToCredits, formatInr } from '~/utils';
import { NotificationSeverity } from '~/common';
import { parseRate } from '../Pricing/rates';
import { useLocalize } from '~/hooks';

/**
 * Reuses the exact Add/Remove-recipient row pattern `GrantDialog.tsx` already has, sourced from
 * the department's members instead of a root's descendants — crucially, with no root exclusion:
 * the Department Head is just another selectable member in every row, the final confirmed
 * product decision for this feature.
 */
export default function DisburseSection({
  members,
  poolBalance,
}: {
  members: TDepartmentMember[];
  poolBalance: number;
}) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const { showToast } = useToastContext();

  const [recipientIds, setRecipientIds] = useState<string[]>(['']);
  const [amountDraft, setAmountDraft] = useState('');
  const [preview, setPreview] = useState<TDisbursePreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewDisburse = useDisbursePreview();
  const confirmDisburse = useDisburseConfirm();

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const memberItems = useMemo(
    () =>
      members.map((member) => ({
        label: `${member.name} (${member.email})`,
        value: member.userId,
      })),
    [members],
  );
  const selectedRecipientIds = useMemo(() => new Set(recipientIds.filter(Boolean)), [recipientIds]);
  const itemsExcluding = (currentValue: string) =>
    memberItems.filter(
      (item) => item.value === currentValue || !selectedRecipientIds.has(item.value),
    );

  const inrAmount = parseRate(amountDraft);
  const totalAmount = inrAmount == null ? null : inrToCredits(inrAmount);

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
    setRecipientIds(['']);
    setAmountDraft('');
    setPreview(null);
    setError(null);
  };

  const runPreview = () => {
    const recipients = Array.from(selectedRecipientIds);
    if (recipients.length === 0) {
      setError(localize('com_admin_token_grant_invalid_amount'));
      return;
    }
    if (totalAmount == null || totalAmount <= 0) {
      setError(localize('com_admin_token_grant_invalid_amount'));
      return;
    }
    setError(null);
    previewDisburse.mutate(
      { recipientUserIds: recipients, totalAmount },
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
    const recipients = Array.from(selectedRecipientIds);
    const expectedBalances = Object.fromEntries(
      preview.rows.map((row) => [row.userId, row.currentBalance]),
    );
    confirmDisburse.mutate(
      {
        recipientUserIds: recipients,
        totalAmount,
        expectedPoolBalance: preview.poolBalance,
        expectedBalances,
      },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_admin_department_head_disburse_saved'),
            severity: NotificationSeverity.SUCCESS,
          });
          resetForm();
        },
        onError: (err) => {
          const poolConflict = getPoolConflictError(err);
          setPreview(null);
          if (poolConflict && 'requested' in poolConflict && poolConflict.requested != null) {
            const message = localize('com_admin_department_head_disburse_pool_insufficient_error');
            setError(message);
            showToast({ message, severity: NotificationSeverity.ERROR });
            return;
          }
          if (poolConflict && 'currentPoolBalance' in poolConflict) {
            const message = localize('com_admin_department_head_disburse_pool_stale_error');
            setError(message);
            showToast({ message, severity: NotificationSeverity.ERROR });
            return;
          }
          const message = getResponseErrorMessage(err, localize('com_admin_token_grant_error'));
          setError(message);
          showToast({ message, severity: NotificationSeverity.ERROR });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label variant="section">{localize('com_admin_department_head_recipients_label')}</Label>
        {recipientIds.map((id, index) => (
          <div key={index} className="flex items-center gap-2 md:max-w-sm">
            <ControlCombobox
              selectId={`disburse-recipient-${index}`}
              selectedValue={id}
              displayValue={id ? (memberById.get(id)?.name ?? '') : ''}
              items={itemsExcluding(id)}
              setValue={(value) => updateRecipient(index, value)}
              ariaLabel={localize('com_admin_department_head_recipients_label')}
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
      </div>

      <div className="flex flex-col gap-1 md:max-w-xs">
        <Label htmlFor="disburse-amount" variant="section">
          {localize('com_admin_token_grant_amount_label')}
        </Label>
        <Input
          id="disburse-amount"
          inputMode="decimal"
          value={amountDraft}
          onChange={(e) => changeAmount(e.target.value)}
          disabled={previewDisburse.isLoading || confirmDisburse.isLoading}
        />
        <p className="text-xs text-text-secondary">
          {inrAmount == null ? '—' : formatInr(inrAmount, locale)} /{' '}
          {formatInr(creditsToInr(poolBalance), locale)}{' '}
          {localize('com_admin_department_balance_pool_label')}
        </p>
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
                  {formatInr(creditsToInr(row.currentBalance), locale)}
                </td>
                <td className="px-3 py-1.5">{formatInr(creditsToInr(row.newBalance), locale)}</td>
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
            disabled={confirmDisburse.isLoading}
            onClick={runConfirm}
          >
            {confirmDisburse.isLoading ? (
              <Spinner />
            ) : (
              localize('com_admin_department_head_disburse_confirm_submit')
            )}
          </Button>
        ) : (
          <Button
            variant="submit"
            type="button"
            disabled={previewDisburse.isLoading}
            onClick={runPreview}
          >
            {previewDisburse.isLoading ? (
              <Spinner />
            ) : (
              localize('com_admin_department_head_disburse_submit')
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
