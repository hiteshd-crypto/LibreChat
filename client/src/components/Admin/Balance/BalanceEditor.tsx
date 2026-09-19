import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import { useAdminUserBalance, useSetUserBalance, getBalanceConflict } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { NotificationSeverity } from '~/common';
import { parseRate } from '../Pricing/rates';
import { formatUsd } from './credits';
import { useLocalize } from '~/hooks';

const INPUT_ID = 'admin-balance-input';
const ERROR_ID = 'admin-balance-error';

export default function BalanceEditor({ userId, userName }: { userId: string; userName: string }) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const { showToast } = useToastContext();
  const { data, isLoading, isError } = useAdminUserBalance(userId);
  const setBalance = useSetUserBalance();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div data-testid="admin-balance-loading" className="flex items-center py-2">
        <Spinner />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="py-2 text-sm text-text-secondary">
        {localize('com_admin_balance_load_error')}
      </p>
    );
  }

  const startEditing = () => {
    setDraft(String(data.tokenCredits));
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setError(null);
    setEditing(false);
  };

  const save = () => {
    const tokenCredits = parseRate(draft);
    if (tokenCredits === null) {
      setError(localize('com_admin_balance_invalid'));
      return;
    }
    setError(null);
    setBalance.mutate(
      { userId, tokenCredits, expectedTokenCredits: data.hasRecord ? data.tokenCredits : null },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_admin_balance_saved', { 0: userName }),
            severity: NotificationSeverity.SUCCESS,
          });
          setEditing(false);
        },
        onError: (err) => {
          const conflict = getBalanceConflict(err);
          if (conflict) {
            setError(localize('com_admin_balance_conflict', { 0: conflict.tokenCredits }));
            return;
          }
          showToast({
            message: getResponseErrorMessage(err, localize('com_admin_balance_save_error')),
            severity: NotificationSeverity.ERROR,
          });
        },
      },
    );
  };

  const shownCredits = editing ? parseRate(draft) : data.tokenCredits;

  return (
    <>
      <div className="flex w-full flex-col md:max-w-xs">
        <Label htmlFor={INPUT_ID} variant="section">
          {localize('com_admin_balance_label')}
        </Label>
        <Input
          id={INPUT_ID}
          inputMode="decimal"
          value={editing ? draft : String(data.tokenCredits)}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={!editing}
          disabled={setBalance.isLoading}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ERROR_ID : undefined}
        />
        {error ? (
          <p id={ERROR_ID} role="alert" className="mt-1 text-xs text-text-destructive">
            {error}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-text-secondary">
          {shownCredits === null
            ? '—'
            : localize('com_admin_balance_usd', { 0: formatUsd(shownCredits, locale) })}
        </p>
        {data.hasRecord ? null : (
          <p role="status" className="mt-1 text-xs text-text-secondary">
            {localize('com_admin_balance_no_record')}
          </p>
        )}
      </div>
      <div className="flex gap-2 md:pt-6">
        {editing ? (
          <>
            <Button variant="submit" type="button" disabled={setBalance.isLoading} onClick={save}>
              {setBalance.isLoading ? <Spinner /> : localize('com_ui_save')}
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={setBalance.isLoading}
              onClick={cancel}
            >
              {localize('com_ui_cancel')}
            </Button>
          </>
        ) : (
          <Button variant="outline" type="button" onClick={startEditing}>
            {localize('com_ui_update')}
          </Button>
        )}
      </div>
    </>
  );
}
