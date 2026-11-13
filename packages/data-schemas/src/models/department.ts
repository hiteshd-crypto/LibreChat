import { Model } from 'mongoose';
import type { IDepartment } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import departmentSchema from '~/schema/department';

export function createDepartmentModel(mongoose: typeof import('mongoose')): Model<IDepartment> {
  applyTenantIsolation(departmentSchema);
  return mongoose.models.Department || mongoose.model<IDepartment>('Department', departmentSchema);
}
