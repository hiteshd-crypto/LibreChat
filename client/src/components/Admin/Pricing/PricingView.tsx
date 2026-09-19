import { useMemo, useState } from 'react';
import {
  Button,
  Input,
  Spinner,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@librechat/client';
import type { TAdminPricingRate } from 'librechat-data-provider';
import { useAdminPricing } from '~/data-provider';
import DeleteRateDialog from './DeleteRateDialog';
import { useLocalize } from '~/hooks';
import PricingRow from './PricingRow';

const HEAD_CLASS = 'px-3 py-2 text-left font-medium text-text-secondary';

export default function PricingView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useAdminPricing();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TAdminPricingRate | null>(null);

  const rates = useMemo(() => data?.rates ?? [], [data]);
  const existingKeys = useMemo(() => new Set(rates.map((r) => r.modelKey)), [rates]);
  const ratesByKey = useMemo(() => new Map(rates.map((r) => [r.modelKey, r])), [rates]);
  const modelItems = useMemo(
    () => rates.map((r) => ({ label: r.modelKey, value: r.modelKey })),
    [rates],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rates.filter((r) => r.modelKey.toLowerCase().includes(q)) : rates;
  }, [rates, search]);

  if (isLoading) {
    return (
      <div data-testid="admin-pricing-loading" className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-text-secondary">
        {localize('com_admin_pricing_load_error')}
      </p>
    );
  }

  const showTable = visible.length > 0 || adding;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">
          {localize('com_admin_pricing_title')}
        </h2>
        <p className="text-sm text-text-secondary">{localize('com_admin_pricing_hint')}</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={localize('com_admin_pricing_search_placeholder')}
          placeholder={localize('com_admin_pricing_search_placeholder')}
          className="max-w-xs"
        />
        <Button variant="submit" type="button" disabled={adding} onClick={() => setAdding(true)}>
          {localize('com_admin_pricing_add')}
        </Button>
      </div>

      {showTable ? (
        <Table aria-label={localize('com_admin_pricing_title')}>
          <TableHeader>
            <TableRow className="border-b border-border-light">
              <TableHead scope="col" className={HEAD_CLASS}>
                {localize('com_admin_pricing_col_model')}
              </TableHead>
              <TableHead scope="col" className={HEAD_CLASS}>
                {localize('com_admin_pricing_col_prompt')}
              </TableHead>
              <TableHead scope="col" className={HEAD_CLASS}>
                {localize('com_admin_pricing_col_completion')}
              </TableHead>
              <TableHead scope="col" className={`${HEAD_CLASS} text-right`}>
                {localize('com_admin_pricing_col_actions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adding ? (
              <PricingRow
                existingKeys={existingKeys}
                ratesByKey={ratesByKey}
                modelItems={modelItems}
                onDiscard={() => setAdding(false)}
              />
            ) : null}
            {visible.map((rate) => (
              <PricingRow
                key={rate.modelKey}
                rate={rate}
                existingKeys={existingKeys}
                ratesByKey={ratesByKey}
                modelItems={modelItems}
                onRequestDelete={setDeleteTarget}
              />
            ))}
          </TableBody>
        </Table>
      ) : (
        <p role="status" className="text-sm text-text-secondary">
          {localize(rates.length === 0 ? 'com_admin_pricing_empty' : 'com_admin_pricing_no_match')}
        </p>
      )}

      <DeleteRateDialog rate={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
