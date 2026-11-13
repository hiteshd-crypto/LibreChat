import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  OGDialog,
  OGDialogTemplate,
  Button,
  Input,
  Label,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TDepartment } from 'librechat-data-provider';
import { getResponseErrorMessage, creditsToInr, inrToCredits, formatInr } from '~/utils';
import { useGrantDepartmentBalance } from '~/data-provider/Admin/mutations';
import { useDepartmentBalance } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { parseRate } from '../Pricing/rates';
import { useLocalize } from '~/hooks';

/**
 * Super Admin's grant dialog for a Department's pool. Under the pool model, a grant is a
 * single-step `$inc` into `DepartmentBalance.balance` — it can't go stale, so there is no
 * preview/confirm dance here (unlike the per-user hierarchical grant in `GrantDialog.tsx`).
 * "Total current balance" is pool + the sum of every member's personal balance, from
 * `useDepartmentBalance`, which replaces the old head-resolution endpoint entirely.
 *
 * All amounts shown/entered here are INR, converted to/from `tokenCredits` via
 * `creditsToInr`/`inrToCredits` — the same helpers and precedent `BalanceEditor.tsx` already
 * uses for the User Balance page.
 */
export default function DepartmentGrantDialog({
  department,
  onClose,
}: {
  department: TDepartment | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const { showToast } = useToastContext();
  const departmentId = department?._id ?? '';
  const balance = useDepartmentBalance(departmentId);

  const [amountDraft, setAmountDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const grantBalance = useGrantDepartmentBalance();

  const inrAmount = parseRate(amountDraft);
  const totalAmount = inrAmount == null ? null : inrToCredits(inrAmount);
  const hasNoHead = department?.rootRoleKey == null;

  const resetForm = () => {
    setAmountDraft('');
    setError(null);
  };

  const renderBalance = () => {
    if (hasNoHead) {
      return (
        <p role="status" className="text-sm text-text-secondary">
          {localize('com_admin_department_no_head')}
        </p>
      );
    }
    if (balance.isLoading) {
      return <Spinner />;
    }
    if (balance.isError || !balance.data) {
      return (
        <p role="alert" className="text-sm text-text-secondary">
          {localize('com_admin_access_load_error')}
        </p>
      );
    }
    return (
      <p className="text-sm text-text-primary">
        {formatInr(creditsToInr(balance.data.totalBalance), locale)}
      </p>
    );
  };

  const close = () => {
    resetForm();
    onClose();
  };

  const runGrant = () => {
    if (!departmentId || hasNoHead) {
      return;
    }
    if (totalAmount == null || totalAmount <= 0) {
      setError(localize('com_admin_token_grant_invalid_amount'));
      return;
    }
    setError(null);
    grantBalance.mutate(
      { departmentId, body: { amount: totalAmount } },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_admin_token_grant_saved'),
            severity: NotificationSeverity.SUCCESS,
          });
          close();
        },
        onError: (err) => {
          showToast({
            message: getResponseErrorMessage(err, localize('com_admin_token_grant_error')),
            severity: NotificationSeverity.ERROR,
          });
        },
      },
    );
  };

  return (
    <OGDialog
      open={department != null}
      onOpenChange={(value) => {
        if (!value) {
          close();
        }
      }}
    >
      <OGDialogTemplate
        title={department?.name ?? localize('com_admin_department_grant_title')}
        showCloseButton={false}
        className="w-11/12 md:max-w-md"
        main={
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label variant="section">
                {localize('com_admin_department_total_balance_label')}
              </Label>
              {renderBalance()}
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="department-grant-amount" variant="section">
                {localize('com_admin_token_grant_amount_label')}
              </Label>
              <Input
                id="department-grant-amount"
                inputMode="decimal"
                value={amountDraft}
                onChange={(e) => {
                  setAmountDraft(e.target.value);
                  setError(null);
                }}
                disabled={hasNoHead || grantBalance.isLoading}
              />
              <p className="text-xs text-text-secondary">
                {inrAmount == null ? '—' : formatInr(inrAmount, locale)}
              </p>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            type="button"
            disabled={hasNoHead || grantBalance.isLoading}
            onClick={runGrant}
          >
            {grantBalance.isLoading ? <Spinner /> : localize('com_admin_token_grant_submit')}
          </Button>
        }
      />
    </OGDialog>
  );
}
