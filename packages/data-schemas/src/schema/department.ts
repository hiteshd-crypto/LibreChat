import { Schema } from 'mongoose';
import type { IDepartment } from '~/types';

const departmentSchema: Schema<IDepartment> = new Schema(
  {
    name: { type: String, required: true, index: true },
    /** `null` until a top-level role is created for this department (see
     * `setDepartmentRootRole`) — a department starts completely empty. */
    rootRoleKey: { type: String, default: null, index: true },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

/** Partial so multiple empty departments (all `rootRoleKey: null`) never collide on uniqueness. */
departmentSchema.index(
  { rootRoleKey: 1, tenantId: 1 },
  { unique: true, partialFilterExpression: { rootRoleKey: { $type: 'string' } } },
);
departmentSchema.index({ name: 1, tenantId: 1 }, { unique: true });

export default departmentSchema;
