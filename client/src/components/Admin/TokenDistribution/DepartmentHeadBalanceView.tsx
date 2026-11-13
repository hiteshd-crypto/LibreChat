import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner, Tabs, TabsList, TabsTrigger, TabsContent } from '@librechat/client';
import type { TMyHierarchy } from 'librechat-data-provider';
import { useDepartmentBalance, useMyDepartmentMembers } from '~/data-provider';
import { creditsToInr, formatInr } from '~/utils';
import DisburseSection from './DisburseSection';
import TransferSection from './TransferSection';
import { useLocalize } from '~/hooks';

/**
 * Department Head's own balance screen — replaces the generic hierarchical `GrantDialog` for a
 * Head under the pool model. Fetches the department's members and pool/total balance once and
 * shares both across the Disburse and Transfer tabs, so neither tab pays its own round trip.
 */
export default function DepartmentHeadBalanceView({
  departmentHead,
}: {
  departmentHead: NonNullable<TMyHierarchy['departmentHead']>;
}) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const [activeTab, setActiveTab] = useState<'disburse' | 'transfer'>('disburse');

  const balance = useDepartmentBalance(departmentHead.departmentId);
  const members = useMyDepartmentMembers();

  if (balance.isLoading || members.isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  if (balance.isError || !balance.data || members.isError || !members.data) {
    return (
      <p role="alert" className="text-sm text-text-secondary">
        {localize('com_admin_access_load_error')}
      </p>
    );
  }

  const { poolBalance, totalBalance } = balance.data;
  // What members actually hold right now — rises only via disburse/transfer, not the moment a
  // fresh grant lands in the pool (which raises totalBalance and poolBalance by the same amount).
  const availableBalance = totalBalance - poolBalance;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-text-primary">{departmentHead.departmentName}</h3>
        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span>
            {localize('com_admin_department_balance_pool_label')}:{' '}
            <span className="text-text-primary">
              {formatInr(creditsToInr(poolBalance), locale)}
            </span>
          </span>
          <span>
            {localize('com_admin_department_available_balance_label')}:{' '}
            <span className="text-text-primary">
              {formatInr(creditsToInr(availableBalance), locale)}
            </span>
          </span>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'disburse' | 'transfer')}
      >
        <TabsList>
          <TabsTrigger value="disburse">
            {localize('com_admin_department_head_disburse_tab')}
          </TabsTrigger>
          <TabsTrigger value="transfer">
            {localize('com_admin_department_head_transfer_tab')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="disburse" className="p-0 pt-3">
          <DisburseSection members={members.data.members} poolBalance={poolBalance} />
        </TabsContent>
        <TabsContent value="transfer" className="p-0 pt-3">
          <TransferSection members={members.data.members} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
