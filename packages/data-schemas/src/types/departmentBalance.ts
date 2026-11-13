import type { Document, Types } from 'mongoose';

/**
 * A Department's own pool balance — separate from the sum of its members'
 * personal `Balance.tokenCredits`. Super Admin grants land here; a
 * Department Head disburses out of this pool to chosen members.
 */
export interface IDepartmentBalance extends Document {
  department: Types.ObjectId;
  balance: number;
  tenantId?: string;
}
