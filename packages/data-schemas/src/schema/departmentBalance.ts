import { Schema } from 'mongoose';
import type { IDepartmentBalance } from '~/types';

const departmentBalanceSchema: Schema<IDepartmentBalance> = new Schema(
  {
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    balance: { type: Number, default: 0 },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

departmentBalanceSchema.index({ department: 1, tenantId: 1 }, { unique: true });

export default departmentBalanceSchema;
