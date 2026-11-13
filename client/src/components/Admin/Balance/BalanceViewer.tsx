import { useTranslation } from 'react-i18next';
import { Label, Spinner } from '@librechat/client';
import { useAdminUserBalance } from '~/data-provider';
import { creditsToInr, formatInr } from '~/utils';
import { useLocalize } from '~/hooks';

/** Read-only counterpart to `BalanceEditor.tsx` — no edit affordance, no mutation. Used by a
 * Department Head, who may view but never change a balance. */
export default function BalanceViewer({ userId }: { userId: string }) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const { data, isLoading, isError } = useAdminUserBalance(userId);

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

  return (
    <div className="flex w-full flex-col md:max-w-xs">
      <Label variant="section">{localize('com_admin_balance_label')}</Label>
      <p className="text-sm text-text-primary">
        {formatInr(creditsToInr(data.tokenCredits), locale)}
      </p>
      {data.hasRecord ? null : (
        <p role="status" className="mt-1 text-xs text-text-secondary">
          {localize('com_admin_balance_no_record')}
        </p>
      )}
    </div>
  );
}
