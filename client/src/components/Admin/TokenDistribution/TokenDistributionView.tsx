import DepartmentHeadBalanceView from './DepartmentHeadBalanceView';
import DepartmentGrantView from './DepartmentGrantView';
import { useMyHierarchy } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * `/admin/token-distribution` — a Super Admin sees the Department list and
 * sends a lump-sum grant into a Department's pool (`DepartmentGrantView`). A
 * Department Head sees `DepartmentHeadBalanceView`: the pool/total balance
 * header plus Disburse and Transfer tabs, scoped to their own department.
 * `GrantDialog.tsx` stays on disk, untouched, for the legacy per-user
 * hierarchical system — it is simply no longer the UI a Head sees here.
 */
export default function TokenDistributionView() {
  const localize = useLocalize();
  const { data: hierarchy } = useMyHierarchy();
  const isDeptHead = Boolean(hierarchy?.departmentHead) && !hierarchy?.isAdmin;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">
          {localize('com_admin_token_title')}
        </h2>
      </div>
      {hierarchy?.isAdmin ? <DepartmentGrantView /> : null}
      {isDeptHead && hierarchy?.departmentHead ? (
        <DepartmentHeadBalanceView departmentHead={hierarchy.departmentHead} />
      ) : null}
    </div>
  );
}
