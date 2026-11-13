import { Model } from 'mongoose';
import type { IDepartmentBalance } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import departmentBalanceSchema from '~/schema/departmentBalance';

export function createDepartmentBalanceModel(
  mongoose: typeof import('mongoose'),
): Model<IDepartmentBalance> {
  applyTenantIsolation(departmentBalanceSchema);
  return (
    mongoose.models.DepartmentBalance ||
    mongoose.model<IDepartmentBalance>('DepartmentBalance', departmentBalanceSchema)
  );
}
