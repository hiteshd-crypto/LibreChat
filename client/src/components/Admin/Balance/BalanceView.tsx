import { useLocalize } from '~/hooks';

export default function BalanceView() {
  const localize = useLocalize();
  return (
    <h2 className="text-base font-semibold text-text-primary">
      {localize('com_admin_balance_title')}
    </h2>
  );
}
