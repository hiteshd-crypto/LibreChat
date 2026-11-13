import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ControlCombobox, Input, Label, Spinner, useToastContext } from '@librechat/client';
import type { TDepartmentMember, TTransferPreviewResponse } from 'librechat-data-provider';
import { useTransferPreview, useTransferConfirm } from '~/data-provider/Admin/mutations';
import { getResponseErrorMessage, creditsToInr, inrToCredits, formatInr } from '~/utils';
import { NotificationSeverity } from '~/common';
import { parseRate } from '../Pricing/rates';
import { useLocalize } from '~/hooks';

/**
 * Member-to-member rebalance within the caller's own department — a separate, explicit action
 * from Disburse (final product decision: not folded into "Add Recipient"). Give <= take, bounded
 * by what the source member actually has; money never leaves the department, it only moves
 * between two of its members.
 */
export default function TransferSection({ members }: { members: TDepartmentMember[] }) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const { showToast } = useToastContext();

  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [amountDraft, setAmountDraft] = useState('');
  const [preview, setPreview] = useState<TTransferPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewTransfer = useTransferPreview();
  const confirmTransfer = useTransferConfirm();

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
  const fromItems = memberItems.filter((item) => item.value !== toUserId);
  const toItems = memberItems.filter((item) => item.value !== fromUserId);

  const inrAmount = parseRate(amountDraft);
  const amount = inrAmount == null ? null : inrToCredits(inrAmount);

  const changeFrom = (value: string) => {
    setFromUserId(value);
    setPreview(null);
  };
  const changeTo = (value: string) => {
    setToUserId(value);
    setPreview(null);
  };
  const changeAmount = (value: string) => {
    setAmountDraft(value);
    setPreview(null);
  };

  const resetForm = () => {
    setFromUserId('');
    setToUserId('');
    setAmountDraft('');
    setPreview(null);
    setError(null);
  };

  const runPreview = () => {
    if (!fromUserId || !toUserId) {
      setError(localize('com_admin_token_grant_invalid_amount'));
      return;
    }
    if (amount == null || amount <= 0) {
      setError(localize('com_admin_token_grant_invalid_amount'));
      return;
    }
    setError(null);
    previewTransfer.mutate(
      { fromUserId, toUserId, amount },
      {
        onSuccess: (response) => setPreview(response),
        onError: (err) => {
          setPreview(null);
          setError(
            getResponseErrorMessage(
              err,
              localize('com_admin_department_head_transfer_insufficient_error'),
            ),
          );
        },
      },
    );
  };

  const runConfirm = () => {
    if (!preview || amount == null) {
      return;
    }
    confirmTransfer.mutate(
      {
        fromUserId,
        toUserId,
        amount,
        expectedFromBalance: preview.from.currentBalance,
        expectedToBalance: preview.to.currentBalance,
      },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_admin_department_head_transfer_saved'),
            severity: NotificationSeverity.SUCCESS,
          });
          resetForm();
        },
        onError: (err) => {
          setPreview(null);
          const message = getResponseErrorMessage(err, localize('com_admin_token_grant_error'));
          setError(message);
          showToast({ message, severity: NotificationSeverity.ERROR });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 md:max-w-sm">
        <Label variant="section">{localize('com_admin_department_head_transfer_from_label')}</Label>
        <ControlCombobox
          selectId="transfer-from"
          selectedValue={fromUserId}
          displayValue={fromUserId ? (memberById.get(fromUserId)?.name ?? '') : ''}
          items={fromItems}
          setValue={changeFrom}
          ariaLabel={localize('com_admin_department_head_transfer_from_label')}
          searchPlaceholder={localize('com_admin_balance_user_search')}
          selectPlaceholder={localize('com_admin_balance_user_placeholder')}
          isCollapsed={false}
          showCarat={true}
          variant="field"
        />
      </div>

      <div className="flex flex-col gap-1 md:max-w-sm">
        <Label variant="section">{localize('com_admin_department_head_transfer_to_label')}</Label>
        <ControlCombobox
          selectId="transfer-to"
          selectedValue={toUserId}
          displayValue={toUserId ? (memberById.get(toUserId)?.name ?? '') : ''}
          items={toItems}
          setValue={changeTo}
          ariaLabel={localize('com_admin_department_head_transfer_to_label')}
          searchPlaceholder={localize('com_admin_balance_user_search')}
          selectPlaceholder={localize('com_admin_balance_user_placeholder')}
          isCollapsed={false}
          showCarat={true}
          variant="field"
        />
      </div>

      <div className="flex flex-col gap-1 md:max-w-xs">
        <Label htmlFor="transfer-amount" variant="section">
          {localize('com_admin_token_grant_amount_label')}
        </Label>
        <Input
          id="transfer-amount"
          inputMode="decimal"
          value={amountDraft}
          onChange={(e) => changeAmount(e.target.value)}
          disabled={previewTransfer.isLoading || confirmTransfer.isLoading}
        />
        {preview ? (
          <p className="text-xs text-text-secondary">
            {localize('com_admin_department_head_transfer_amount_cap_caption', {
              0: formatInr(creditsToInr(preview.from.currentBalance), locale),
            })}
          </p>
        ) : null}
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
            {[preview.from, preview.to].map((side) => (
              <tr key={side.userId} className="border-b border-border-light last:border-b-0">
                <td className="border-r border-border-light px-3 py-1.5">{side.name}</td>
                <td className="border-r border-border-light px-3 py-1.5">
                  {formatInr(creditsToInr(side.currentBalance), locale)}
                </td>
                <td className="px-3 py-1.5">{formatInr(creditsToInr(side.newBalance), locale)}</td>
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
            disabled={confirmTransfer.isLoading}
            onClick={runConfirm}
          >
            {confirmTransfer.isLoading ? (
              <Spinner />
            ) : (
              localize('com_admin_department_head_transfer_confirm_submit')
            )}
          </Button>
        ) : (
          <Button
            variant="submit"
            type="button"
            disabled={previewTransfer.isLoading}
            onClick={runPreview}
          >
            {previewTransfer.isLoading ? (
              <Spinner />
            ) : (
              localize('com_admin_department_head_transfer_submit')
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
