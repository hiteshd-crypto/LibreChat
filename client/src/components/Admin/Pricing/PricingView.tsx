import { useLocalize } from '~/hooks';

export default function PricingView() {
  const localize = useLocalize();
  return (
    <h2 className="text-base font-semibold text-text-primary">
      {localize('com_admin_pricing_title')}
    </h2>
  );
}
