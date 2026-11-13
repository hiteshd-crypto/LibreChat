import type { Document } from 'mongoose';

/**
 * A Department is a thin label over one top-level custom-role branch
 * (a `Role` with `parentRole: null`). It does not own or cascade to the
 * underlying Role branch — deleting a Department never deletes its roles.
 */
export interface IDepartment extends Document {
  name: string;
  /** The branch-root Role's `roleKey` (that role's `parentRole` must be `null`), or
   * `null` for a newly created department with no role established yet. */
  rootRoleKey: string | null;
  tenantId?: string;
}

export interface CreateDepartmentRequest {
  name: string;
  /** Omitted to create an empty department; set to wrap an existing top-level branch. */
  rootRoleKey?: string;
  tenantId?: string;
}
