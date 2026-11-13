import { useMemo, useState } from 'react';
import {
  Button,
  ControlCombobox,
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
const MASTER_SELECT_ID = 'admin-pricing-master-select';

export default function PricingView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useAdminPricing();
  const [adding, setAdding] = useState(false);
  const [displayedKeys, setDisplayedKeys] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<TAdminPricingRate | null>(null);

  const rates = useMemo(() => data?.rates ?? [], [data]);
  const existingKeys = useMemo(() => new Set(rates.map((r) => r.modelKey)), [rates]);
  const modelItems = useMemo(
    () =>
      rates.map((r) => ({
        label: r.modelKey,
        value: r.modelKey,
        selected: displayedKeys.has(r.modelKey),
      })),
    [rates, displayedKeys],
  );
  const displayed = useMemo(
    () => rates.filter((r) => displayedKeys.has(r.modelKey)),
    [rates, displayedKeys],
  );

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

  const toggleModel = (key: string) => {
    setDisplayedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const clearAll = () => setDisplayedKeys(new Set());

  const showTable = displayed.length > 0 || adding;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">
          {localize('com_admin_pricing_title')}
        </h2>
        <p className="text-sm text-text-secondary">{localize('com_admin_pricing_hint')}</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="max-w-xs flex-grow">
          <ControlCombobox
            selectId={MASTER_SELECT_ID}
            selectedValue=""
            displayValue=""
            items={modelItems}
            setValue={toggleModel}
            ariaLabel={localize('com_admin_pricing_model_select_label')}
            searchPlaceholder={localize('com_admin_pricing_model_search')}
            selectPlaceholder={localize('com_admin_pricing_model_select_label')}
            isCollapsed={false}
            showCarat={true}
            variant="field"
          />
        </div>
        <div className="flex items-center gap-2">
          {displayed.length > 0 ? (
            <Button variant="outline" type="button" onClick={clearAll}>
              {localize('com_admin_pricing_clear_all')}
            </Button>
          ) : null}
          <Button variant="submit" type="button" disabled={adding} onClick={() => setAdding(true)}>
            {localize('com_admin_pricing_add')}
          </Button>
        </div>
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
              <PricingRow existingKeys={existingKeys} onDiscard={() => setAdding(false)} />
            ) : null}
            {displayed.map((rate) => (
              <PricingRow
                key={rate.modelKey}
                rate={rate}
                existingKeys={existingKeys}
                onRequestDelete={setDeleteTarget}
              />
            ))}
          </TableBody>
        </Table>
      ) : (
        <p role="status" className="text-sm text-text-secondary">
          {localize(
            rates.length === 0 ? 'com_admin_pricing_empty' : 'com_admin_pricing_select_prompt',
          )}
        </p>
      )}

      <DeleteRateDialog
        key={deleteTarget?.modelKey ?? 'closed'}
        rate={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
