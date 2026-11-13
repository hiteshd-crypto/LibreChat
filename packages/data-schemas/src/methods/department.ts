import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { SystemCapability } from '~/admin/capabilities';
import type { IDepartment, IRole } from '~/types';
import { SystemCapabilities } from '~/admin/capabilities';
import logger from '~/config/winston';

const SYSTEM_ROLE_NAMES = new Set<string>(Object.values(SystemRoles));

/** Case-insensitive check, consistent with `isSystemRoleName` in `methods/role.ts`. */
function isSystemRoleName(name: string): boolean {
  return SYSTEM_ROLE_NAMES.has(name.toUpperCase());
}

export class DepartmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DepartmentConflictError';
  }
}

export interface DepartmentDeps {
  /** Ancestor-walk from `methods/role.ts`, used to resolve a role's branch root. */
  getAncestorRoleKeys: (roleKey: string) => Promise<string[]>;
  /** From `methods/systemGrant.ts` — used to auto-grant `DEPARTMENT_HEAD` on create/migrate. */
  grantCapability: (args: {
    principalType: PrincipalType;
    principalId: string;
    capability: SystemCapability;
    tenantId?: string;
  }) => Promise<{ grant: unknown; created: boolean }>;
}

export function createDepartmentMethods(
  mongoose: typeof import('mongoose'),
  deps: DepartmentDeps,
): {
  createDepartment: (input: {
    name: string;
    /** Omitted to create an empty department (`rootRoleKey: null`); set to wrap an
     * existing top-level branch. */
    rootRoleKey?: string;
    tenantId?: string;
  }) => Promise<IDepartment>;
  listDepartments: (options?: { tenantId?: string }) => Promise<IDepartment[]>;
  getDepartmentById: (departmentId: string, tenantId?: string) => Promise<IDepartment | null>;
  getDepartmentByRootRoleKey: (
    rootRoleKey: string,
    tenantId?: string,
  ) => Promise<IDepartment | null>;
  getDepartmentForRoleKey: (roleKey: string, tenantId?: string) => Promise<IDepartment | null>;
  renameDepartment: (departmentId: string, name: string, tenantId?: string) => Promise<IDepartment>;
  deleteDepartment: (departmentId: string, tenantId?: string) => Promise<IDepartment | null>;
  /** Atomically claims an empty department's root role — the only way a department
   * transitions from empty to staffed. Returns `null` if the department doesn't
   * exist or already has a root role (lost a race to a concurrent claim). */
  setDepartmentRootRole: (
    departmentId: string,
    rootRoleKey: string,
    tenantId?: string,
  ) => Promise<IDepartment | null>;
  /** Reverts a department to empty (`rootRoleKey: null`) when its current root
   * role is deleted. */
  clearDepartmentRootRole: (rootRoleKey: string, tenantId?: string) => Promise<IDepartment | null>;
  migrateDepartments: (options?: { dryRun?: boolean }) => Promise<{
    created: number;
    granted: number;
    dryRun: boolean;
    planned: string[];
  }>;
} {
  const { getAncestorRoleKeys, grantCapability } = deps;

  /**
   * Creates a Department. Omitting `rootRoleKey` creates a completely empty
   * department (no branch yet) — the Super Admin establishes its root role
   * afterward via `setDepartmentRootRole`. Passing `rootRoleKey` wraps an
   * existing top-level custom-role branch instead (validates `parentRole ===
   * null`); this path does not grant the `DEPARTMENT_HEAD` capability —
   * callers (the admin handler, and `migrateDepartments` below) are
   * responsible for that.
   */
  async function createDepartment(input: {
    name: string;
    rootRoleKey?: string;
    tenantId?: string;
  }): Promise<IDepartment> {
    const { rootRoleKey, tenantId } = input;
    const name = input.name?.trim();
    if (!name) {
      throw new Error('Department name is required');
    }
    if (rootRoleKey != null) {
      const Role = mongoose.models.Role as Model<IRole>;
      const role = await Role.findOne({ roleKey: rootRoleKey }, 'parentRole name').lean();
      if (!role) {
        throw new Error(`Role "${rootRoleKey}" does not exist`);
      }
      if (role.parentRole != null) {
        throw new Error(`Role "${rootRoleKey}" is not a top-level branch root`);
      }
    }

    const Department = mongoose.models.Department as Model<IDepartment>;
    try {
      const department = await new Department({
        name,
        rootRoleKey: rootRoleKey ?? null,
        tenantId,
      }).save();
      if (rootRoleKey != null) {
        const Role = mongoose.models.Role as Model<IRole>;
        await Role.updateOne({ roleKey: rootRoleKey }, { $set: { departmentExcluded: false } });
      }
      return department.toObject() as IDepartment;
    } catch (err) {
      /** The `{ rootRoleKey, tenantId }` / `{ name, tenantId }` unique indexes
       * translate a concurrent-create race into a typed conflict, the same way
       * `createRoleByName` handles sibling-name clashes. */
      if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
        throw new DepartmentConflictError(
          rootRoleKey != null
            ? `A department named "${name}" or wrapping role "${rootRoleKey}" already exists`
            : `A department named "${name}" already exists`,
        );
      }
      throw err;
    }
  }

  async function listDepartments(options?: { tenantId?: string }): Promise<IDepartment[]> {
    const Department = mongoose.models.Department as Model<IDepartment>;
    const filter = options?.tenantId != null ? { tenantId: options.tenantId } : {};
    return await Department.find(filter).sort({ name: 1 }).lean<IDepartment[]>();
  }

  async function getDepartmentById(
    departmentId: string,
    tenantId?: string,
  ): Promise<IDepartment | null> {
    const Department = mongoose.models.Department as Model<IDepartment>;
    const filter: Record<string, unknown> = { _id: departmentId };
    if (tenantId != null) {
      filter.tenantId = tenantId;
    }
    return await Department.findOne(filter).lean<IDepartment>();
  }

  async function getDepartmentByRootRoleKey(
    rootRoleKey: string,
    tenantId?: string,
  ): Promise<IDepartment | null> {
    const Department = mongoose.models.Department as Model<IDepartment>;
    const filter: Record<string, unknown> = { rootRoleKey };
    if (tenantId != null) {
      filter.tenantId = tenantId;
    }
    return await Department.findOne(filter).lean<IDepartment>();
  }

  /**
   * The single function every piece of department-scoping middleware calls to
   * answer "which department, if any, owns this role." Walks ancestors to the
   * branch root, then resolves the Department wrapping that root.
   */
  async function getDepartmentForRoleKey(
    roleKey: string,
    tenantId?: string,
  ): Promise<IDepartment | null> {
    const ancestors = await getAncestorRoleKeys(roleKey);
    const rootKey = ancestors.length > 0 ? ancestors[ancestors.length - 1] : roleKey;
    return await getDepartmentByRootRoleKey(rootKey, tenantId);
  }

  async function renameDepartment(
    departmentId: string,
    name: string,
    tenantId?: string,
  ): Promise<IDepartment> {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new Error('Department name is required');
    }
    const Department = mongoose.models.Department as Model<IDepartment>;
    const filter: Record<string, unknown> = { _id: departmentId };
    if (tenantId != null) {
      filter.tenantId = tenantId;
    }
    try {
      const department = await Department.findOneAndUpdate(
        filter,
        { $set: { name: trimmed } },
        { new: true },
      ).lean<IDepartment>();
      if (!department) {
        throw new Error(`Department "${departmentId}" not found`);
      }
      return department;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
        throw new DepartmentConflictError(`A department named "${trimmed}" already exists`);
      }
      throw err;
    }
  }

  /**
   * Deletes only the `Department` label — never touches the underlying Role
   * branch or its members. Departments are a thin label over roles, not vice
   * versa; this is intentional and must not be "fixed" into a cascading
   * delete later. If the department had a `rootRoleKey`, the role is marked
   * `departmentExcluded` so `migrateDepartments` does not re-wrap it on the
   * next boot — a deliberate unwrap must stay unwrapped.
   */
  async function deleteDepartment(
    departmentId: string,
    tenantId?: string,
  ): Promise<IDepartment | null> {
    const Department = mongoose.models.Department as Model<IDepartment>;
    const filter: Record<string, unknown> = { _id: departmentId };
    if (tenantId != null) {
      filter.tenantId = tenantId;
    }
    const deleted = await Department.findOneAndDelete(filter).lean<IDepartment>();
    if (deleted?.rootRoleKey != null) {
      const Role = mongoose.models.Role as Model<IRole>;
      await Role.updateOne(
        { roleKey: deleted.rootRoleKey },
        { $set: { departmentExcluded: true } },
      );
    }
    return deleted;
  }

  /**
   * Atomically claims an empty department's root role — the filter requires
   * `rootRoleKey: null` so two concurrent claims for the same department can
   * never both succeed; the loser gets `null` back and must not assume the
   * role it just created became the department's head.
   */
  async function setDepartmentRootRole(
    departmentId: string,
    rootRoleKey: string,
    tenantId?: string,
  ): Promise<IDepartment | null> {
    const Department = mongoose.models.Department as Model<IDepartment>;
    const filter: Record<string, unknown> = { _id: departmentId, rootRoleKey: null };
    if (tenantId != null) {
      filter.tenantId = tenantId;
    }
    const updated = await Department.findOneAndUpdate(
      filter,
      { $set: { rootRoleKey } },
      { new: true },
    ).lean<IDepartment>();
    if (updated != null) {
      const Role = mongoose.models.Role as Model<IRole>;
      await Role.updateOne({ roleKey: rootRoleKey }, { $set: { departmentExcluded: false } });
    }
    return updated;
  }

  /**
   * Reverts a department to empty when its root role is deleted — the filter
   * requires `rootRoleKey: thisKey` so a department that was already
   * re-linked to a different role in the meantime is left untouched. Returns
   * `null` when no department currently points at `rootRoleKey`.
   */
  async function clearDepartmentRootRole(
    rootRoleKey: string,
    tenantId?: string,
  ): Promise<IDepartment | null> {
    const Department = mongoose.models.Department as Model<IDepartment>;
    const filter: Record<string, unknown> = { rootRoleKey };
    if (tenantId != null) {
      filter.tenantId = tenantId;
    }
    return await Department.findOneAndUpdate(
      filter,
      { $set: { rootRoleKey: null } },
      { new: true },
    ).lean<IDepartment>();
  }

  /**
   * One-time, idempotent migration that auto-wraps every existing top-level
   * custom-role branch (`Role` with `parentRole === null`, excluding system
   * roles) in a Department named after the branch, and grants `DEPARTMENT_HEAD`
   * to its root role. Nothing is deleted or reparented. Safe to run on every
   * boot — a branch that already has a Department, or a root that already
   * holds the grant, is skipped. A role whose Department was deliberately
   * deleted (`departmentExcluded: true`) is skipped too — it stays unwrapped
   * until an admin re-wraps it via `createDepartment`/`setDepartmentRootRole`.
   */
  async function migrateDepartments(options: { dryRun?: boolean } = {}): Promise<{
    created: number;
    granted: number;
    dryRun: boolean;
    planned: string[];
  }> {
    const dryRun = options.dryRun === true;
    const Role = mongoose.models.Role as Model<IRole>;
    const Department = mongoose.models.Department as Model<IDepartment>;
    const planned: string[] = [];

    const topLevelRoles = await Role.find(
      { parentRole: null },
      'roleKey name tenantId departmentExcluded',
    ).lean();
    const customRoots = topLevelRoles.filter(
      (role) => !isSystemRoleName(role.name) && role.departmentExcluded !== true,
    );

    let created = 0;
    let granted = 0;
    for (const role of customRoots) {
      const tenantId = (role as unknown as { tenantId?: string }).tenantId;
      const departmentFilter = {
        rootRoleKey: role.roleKey,
        tenantId: tenantId != null ? tenantId : { $exists: false },
      };
      const existingDepartment = await Department.findOne(departmentFilter).lean();
      if (!existingDepartment) {
        planned.push(`role "${role.name}" (${role.roleKey}) → new Department "${role.name}"`);
        created += 1;
        if (!dryRun) {
          await createDepartment({ name: role.name, rootRoleKey: role.roleKey, tenantId });
        }
      }

      const grantFilter = {
        principalType: PrincipalType.ROLE,
        principalId: role.roleKey,
        capability: SystemCapabilities.DEPARTMENT_HEAD,
        tenantId: tenantId != null ? tenantId : { $exists: false },
      };

      const existingGrant = await mongoose.connection
        .collection('systemgrants')
        .findOne(grantFilter);
      if (!existingGrant) {
        planned.push(`grant DEPARTMENT_HEAD → ${role.roleKey}`);
        granted += 1;
        if (!dryRun) {
          await grantCapability({
            principalType: PrincipalType.ROLE,
            principalId: role.roleKey,
            capability: SystemCapabilities.DEPARTMENT_HEAD,
            tenantId,
          });
        }
      }
    }

    if (!dryRun && (created > 0 || granted > 0)) {
      logger.info(`[migrateDepartments] created=${created} granted=${granted}`);
    }

    return { created, granted, dryRun, planned };
  }

  return {
    createDepartment,
    listDepartments,
    getDepartmentById,
    getDepartmentByRootRoleKey,
    getDepartmentForRoleKey,
    renameDepartment,
    deleteDepartment,
    setDepartmentRootRole,
    clearDepartmentRootRole,
    migrateDepartments,
  };
}

export type DepartmentMethods = ReturnType<typeof createDepartmentMethods>;
