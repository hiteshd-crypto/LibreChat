import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import {
  logger,
  isValidObjectIdString,
  RoleConflictError,
  SystemCapabilities,
} from '@librechat/data-schemas';
import type {
  IRole,
  IUser,
  IConfig,
  AdminMember,
  IDepartment,
  ISystemGrant,
  SystemCapability,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import type { FilterQuery, Types } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';
import { buildAuditContext } from './context';

const systemRoleValues = new Set<string>(Object.values(SystemRoles));

/** Case-insensitive check — the legacy roles route uppercases params. */
function isSystemRoleName(name: string): boolean {
  return systemRoleValues.has(name.toUpperCase());
}

const MAX_NAME_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 2000;
const CONTROL_CHAR_RE = /\p{Cc}/u;
/**
 * A `roleKey` route param is a system-role sentinel (`ADMIN`/`USER`) or a custom
 * role's `_id` string. The shape is not enforced here — an unknown key resolves
 * to a 404 via `getRoleByName` — only that it is a sane, non-control string.
 */
function validateRoleKeyParam(roleKey: string): string | null {
  if (!roleKey || typeof roleKey !== 'string') {
    return 'roleKey parameter is required';
  }
  if (roleKey.length > MAX_NAME_LENGTH) {
    return `roleKey must not exceed ${MAX_NAME_LENGTH} characters`;
  }
  if (CONTROL_CHAR_RE.test(roleKey)) {
    return 'roleKey contains invalid characters';
  }
  return null;
}

function validateRoleName(name: unknown, required: boolean): string | null {
  if (name === undefined) {
    return required ? 'name is required' : null;
  }
  if (typeof name !== 'string' || !name.trim()) {
    return required ? 'name is required' : 'name must be a non-empty string';
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `name must not exceed ${MAX_NAME_LENGTH} characters`;
  }
  if (CONTROL_CHAR_RE.test(trimmed)) {
    return 'name contains invalid characters';
  }
  return null;
}

function validateDescription(description: unknown): string | null {
  if (description === undefined) {
    return null;
  }
  if (typeof description !== 'string') {
    return 'description must be a string';
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}

interface RoleKeyParams {
  roleKey: string;
}

interface RoleMemberParams extends RoleKeyParams {
  userId: string;
}

export type RoleListItem = {
  _id: Types.ObjectId | string;
  roleKey: string;
  name: string;
  description?: string;
  parentRole?: string | null;
  depth?: number;
};

export interface AdminRolesDeps {
  listRoles: (options?: { limit?: number; offset?: number }) => Promise<RoleListItem[]>;
  countRoles: () => Promise<number>;
  getRoleByName: (name: string, fields?: string | string[] | null) => Promise<IRole | null>;
  createRoleByName: (roleData: Partial<IRole>) => Promise<IRole>;
  updateRoleByName: (name: string, updates: Partial<IRole>) => Promise<IRole | null>;
  updateAccessPermissions: (
    name: string,
    perms: Record<string, Record<string, boolean>>,
    roleData?: IRole,
  ) => Promise<void>;
  deleteRoleByName: (name: string) => Promise<IRole | null>;
  /** Re-parents a role in the hierarchy tree; throws RoleConflictError on a cycle. */
  setRoleParent: (roleName: string, newParentName: string | null) => Promise<IRole>;
  /** Direct-children count — a nonzero count blocks deletion. */
  countChildRoles: (roleName: string) => Promise<number>;
  /** Auto-grants VIEW_SUBORDINATES to a newly created custom role, and
   * DEPARTMENT_HEAD to one created via the `departmentId` linking path. */
  grantCapability: (params: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
    capability: SystemCapability;
    tenantId?: string;
    grantedBy?: string | Types.ObjectId;
  }) => Promise<{ grant: ISystemGrant | null; created: boolean }>;
  /** Used only by the `departmentId` top-level-create linking path. */
  getDepartmentById: (departmentId: string, tenantId?: string) => Promise<IDepartment | null>;
  /** Atomically claims an empty department's root role; `null` means the
   * department doesn't exist or already has one (lost a race). */
  setDepartmentRootRole: (
    departmentId: string,
    rootRoleKey: string,
    tenantId?: string,
  ) => Promise<IDepartment | null>;
  /** Reverts a department to empty when the role being deleted is its current
   * root; `null` means no department currently points at this roleKey. */
  clearDepartmentRootRole: (rootRoleKey: string, tenantId?: string) => Promise<IDepartment | null>;
  findUser: (
    criteria: FilterQuery<IUser>,
    fields?: string | string[] | null,
  ) => Promise<IUser | null>;
  updateUser: (userId: string, data: Partial<IUser>) => Promise<IUser | null>;
  listUsersByRole: (
    roleKey: string,
    options?: { limit?: number; offset?: number },
  ) => Promise<IUser[]>;
  countUsersByRole: (roleKey: string) => Promise<number>;
  /** Removes the per-principal config override (keyed by type + name, not ObjectId). */
  deleteConfig: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
  ) => Promise<IConfig | null>;
  /** Removes all ACL entries scoped to this principal. */
  deleteAclEntries: (filter: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
  }) => Promise<void>;
  /** Drops cached prompt group access IDs; role deletion can remove PROMPTGROUP grants. */
  invalidatePromptGroupAccessContext?: () => Promise<void>;
  /** Removes all system capability grants held by this principal and returns
   * the removed grants so each can be audited. */
  deleteGrantsForPrincipal: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
    options?: { tenantId?: string },
  ) => Promise<ISystemGrant[]>;
  /** Optional audit emission for grants removed by the role-deletion cascade.
   * Failure is logged but never blocks the deletion (which has already happened). */
  recordAuditEntry?: (
    input: RecordAuditEntryInput,
    options?: RecordAuditEntryOptions,
  ) => Promise<void>;
}

export function createAdminRolesHandlers(deps: AdminRolesDeps): {
  listRoles: (req: ServerRequest, res: Response) => Promise<Response>;
  getRole: (req: ServerRequest, res: Response) => Promise<Response>;
  createRole: (req: ServerRequest, res: Response) => Promise<Response>;
  updateRole: (req: ServerRequest, res: Response) => Promise<Response>;
  updateRolePermissions: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteRole: (req: ServerRequest, res: Response) => Promise<Response>;
  getRoleMembers: (req: ServerRequest, res: Response) => Promise<Response>;
  addRoleMember: (req: ServerRequest, res: Response) => Promise<Response>;
  removeRoleMember: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    listRoles,
    countRoles,
    getRoleByName,
    createRoleByName,
    updateRoleByName,
    updateAccessPermissions,
    deleteRoleByName,
    setRoleParent,
    countChildRoles,
    grantCapability,
    findUser,
    updateUser,
    listUsersByRole,
    countUsersByRole,
    deleteConfig,
    deleteAclEntries,
    deleteGrantsForPrincipal,
    recordAuditEntry,
    invalidatePromptGroupAccessContext,
    getDepartmentById,
    setDepartmentRootRole,
    clearDepartmentRootRole,
  } = deps;

  /** Emits a `grant.removed` audit entry for each grant the role-deletion cascade
   * removed, so the cascade leaves the same forensic trail as an explicit revoke.
   * Fail-open: the role is already deleted, so a failed audit is logged, not
   * propagated. Sequential to keep the per-tenant hash chain ordered. */
  async function emitGrantRemovals(
    req: ServerRequest,
    roleKey: string,
    roleName: string,
    grants: ISystemGrant[],
  ): Promise<void> {
    if (!recordAuditEntry || grants.length === 0) return;
    const user = req.user;
    const userId = user?._id?.toString() ?? user?.id;
    if (!user || !userId) return;
    const actorName = user.name || user.username || user.email || userId;
    const context = buildAuditContext(req);
    for (const grant of grants) {
      try {
        await recordAuditEntry({
          action: 'grant.removed',
          outcome: 'success',
          severity: 'warning',
          actor: { type: 'user', id: userId, name: actorName },
          target: { type: PrincipalType.ROLE, id: roleKey, name: roleName },
          metadata: { capability: grant.capability },
          context,
          /** Scope each entry to the removed grant's own tenant — a platform
           * admin's role deletion can remove tenant-scoped grants, and those
           * removals must land in the affected tenant's chain, not the caller's. */
          tenantId: grant.tenantId,
        });
      } catch (err) {
        logger.error('[adminRoles] grant.removed audit failed during role deletion', err);
      }
    }
  }

  /**
   * Fetch ceiling used only when `req.departmentScope` is set — a Department
   * Head's own branch is always small, so filtering a single larger-than-page
   * fetch is simpler and safer than teaching `listRoles` a new scoping option
   * (data-schemas stays a dumb data layer, per the scoping design).
   */
  const DEPARTMENT_SCOPE_FETCH_LIMIT = 1000;

  async function listRolesHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const scope = req.departmentScope;
      if (scope) {
        const scopeKeys = new Set(scope.roleKeys);
        const all = await listRoles({ limit: DEPARTMENT_SCOPE_FETCH_LIMIT, offset: 0 });
        const filtered = all.filter((role) => scopeKeys.has(role.roleKey));
        const page = filtered.slice(offset, offset + limit);
        return res.status(200).json({ roles: page, total: filtered.length, limit, offset });
      }
      const [roles, total] = await Promise.all([listRoles({ limit, offset }), countRoles()]);
      return res.status(200).json({ roles, total, limit, offset });
    } catch (error) {
      logger.error('[adminRoles] listRoles error:', error);
      return res.status(500).json({ error: 'Failed to list roles' });
    }
  }

  async function getRoleHandler(req: ServerRequest, res: Response) {
    try {
      const { roleKey } = req.params as RoleKeyParams;
      const paramError = validateRoleKeyParam(roleKey);
      if (paramError) {
        return res.status(400).json({ error: paramError });
      }
      const role = await getRoleByName(roleKey);
      if (!role) {
        return res.status(404).json({ error: 'Role not found' });
      }
      const scope = req.departmentScope;
      if (scope && !scope.roleKeys.includes(roleKey)) {
        return res.status(404).json({ error: 'Role not found' });
      }
      return res.status(200).json({ role });
    } catch (error) {
      logger.error('[adminRoles] getRole error:', error);
      return res.status(500).json({ error: 'Failed to get role' });
    }
  }

  /** Emits a `grant.assigned` audit entry when a top-level role creation links
   * and becomes an empty department's root — the same action/shape
   * `admin/departments.ts` emits for the wrap-existing-role path, for parity. */
  async function emitDepartmentLinkAudit(
    req: ServerRequest,
    department: IDepartment,
    roleKey: string,
  ): Promise<void> {
    if (!recordAuditEntry) return;
    const user = req.user;
    const userId = user?._id?.toString() ?? user?.id;
    if (!user || !userId) return;
    const actorName = user.name || user.username || user.email || userId;
    try {
      await recordAuditEntry({
        action: 'grant.assigned',
        outcome: 'success',
        actor: { type: 'user', id: userId, name: actorName },
        target: { type: PrincipalType.ROLE, id: roleKey, name: department.name },
        metadata: { capability: SystemCapabilities.DEPARTMENT_HEAD },
        context: buildAuditContext(req),
        tenantId: user.tenantId,
      });
    } catch (err) {
      logger.error('[adminRoles] grant.assigned audit failed for department link', err);
    }
  }

  /** Emits a `grant.removed` audit entry when deleting a role un-links it as a
   * department's root — the counterpart to `emitDepartmentLinkAudit`. */
  async function emitDepartmentUnlinkAudit(
    req: ServerRequest,
    department: IDepartment,
    roleKey: string,
  ): Promise<void> {
    if (!recordAuditEntry) return;
    const user = req.user;
    const userId = user?._id?.toString() ?? user?.id;
    if (!user || !userId) return;
    const actorName = user.name || user.username || user.email || userId;
    try {
      await recordAuditEntry({
        action: 'grant.removed',
        outcome: 'success',
        actor: { type: 'user', id: userId, name: actorName },
        target: { type: PrincipalType.ROLE, id: roleKey, name: department.name },
        metadata: { capability: SystemCapabilities.DEPARTMENT_HEAD },
        context: buildAuditContext(req),
        tenantId: user.tenantId,
      });
    } catch (err) {
      logger.error('[adminRoles] grant.removed audit failed for department unlink', err);
    }
  }

  /**
   * Creates a role. `departmentId` is only honored for a top-level create
   * (`parentRole` absent/`null`) and is the sole way an empty department (see
   * `admin/departments.ts`) gets its first role: the department must exist and
   * not already have a root role, checked before the role is minted so a
   * doomed request never creates an orphan. On success the new role becomes
   * the department's `rootRoleKey` and is granted `DEPARTMENT_HEAD`, atomically
   * guarded against a concurrent claim of the same empty department — if that
   * race is lost, the just-created role is deleted and a 409 is returned.
   */
  async function createRoleHandler(req: ServerRequest, res: Response) {
    try {
      const { name, description, permissions, parentRole, departmentId } = req.body as {
        name?: string;
        description?: string;
        permissions?: IRole['permissions'];
        parentRole?: string | null;
        departmentId?: string;
      };
      const nameError = validateRoleName(name, true);
      if (nameError) {
        return res.status(400).json({ error: nameError });
      }
      const descError = validateDescription(description);
      if (descError) {
        return res.status(400).json({ error: descError });
      }
      if (
        permissions !== undefined &&
        (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions))
      ) {
        return res.status(400).json({ error: 'permissions must be an object' });
      }
      if (parentRole != null) {
        if (typeof parentRole !== 'string') {
          return res.status(400).json({ error: 'parentRole must be a roleKey string' });
        }
        const parent = await getRoleByName(parentRole);
        if (!parent) {
          return res.status(400).json({ error: `Parent role "${parentRole}" does not exist` });
        }
        if (isSystemRoleName(parent.name)) {
          return res.status(400).json({ error: 'parentRole cannot be a system role' });
        }
      }
      if (departmentId != null) {
        if (typeof departmentId !== 'string') {
          return res.status(400).json({ error: 'departmentId must be a string' });
        }
        if (parentRole != null) {
          return res
            .status(400)
            .json({ error: 'departmentId is only valid when creating a top-level role' });
        }
      }
      let department: IDepartment | null = null;
      if (departmentId != null) {
        department = await getDepartmentById(departmentId, req.user?.tenantId);
        if (!department) {
          return res.status(404).json({ error: `Department "${departmentId}" not found` });
        }
        if (department.rootRoleKey != null) {
          return res.status(409).json({ error: 'Department already has a root role' });
        }
      }

      const roleData: Partial<IRole> = {
        name: (name as string).trim(),
        permissions: permissions ?? {},
      };
      if (description !== undefined) {
        roleData.description = description;
      }
      if (parentRole !== undefined) {
        roleData.parentRole = parentRole;
      }
      const role = await createRoleByName(roleData);
      await grantCapability({
        principalType: PrincipalType.ROLE,
        principalId: role.roleKey,
        capability: SystemCapabilities.VIEW_SUBORDINATES,
        tenantId: req.user?.tenantId,
      });

      if (department != null) {
        const linked = await setDepartmentRootRole(
          department._id.toString(),
          role.roleKey,
          req.user?.tenantId,
        );
        if (!linked) {
          try {
            await deleteRoleByName(role.roleKey);
          } catch (err) {
            logger.error(
              '[adminRoles] failed to roll back orphan role after losing department-link race',
              err,
            );
          }
          return res.status(409).json({ error: 'Department already has a root role' });
        }
        await grantCapability({
          principalType: PrincipalType.ROLE,
          principalId: role.roleKey,
          capability: SystemCapabilities.DEPARTMENT_HEAD,
          tenantId: req.user?.tenantId,
        });
        await emitDepartmentLinkAudit(req, linked, role.roleKey);
      }

      return res.status(201).json({ role });
    } catch (error) {
      logger.error('[adminRoles] createRole error:', error);
      if (error instanceof RoleConflictError) {
        return res.status(409).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to create role' });
    }
  }

  async function updateRoleHandler(req: ServerRequest, res: Response) {
    try {
      const { roleKey } = req.params as RoleKeyParams;
      const paramError = validateRoleKeyParam(roleKey);
      if (paramError) {
        return res.status(400).json({ error: paramError });
      }
      const body = req.body as {
        name?: string;
        description?: string;
        parentRole?: string | null;
      };
      const nameError = validateRoleName(body.name, false);
      if (nameError) {
        return res.status(400).json({ error: nameError });
      }
      const descError = validateDescription(body.description);
      if (descError) {
        return res.status(400).json({ error: descError });
      }

      /**
       * Re-parenting is its own operation — the client sends `parentRole` alone
       * (a `roleKey` or `null`), never alongside a rename/description change.
       * Handle it here and return before the rename path. `setRoleParent` throws
       * `RoleConflictError` for a cycle, a cross-branch move, or a sibling-name
       * clash, and a plain `Error` for a missing/system parent — all map to 400.
       */
      if (body.parentRole !== undefined) {
        if (isSystemRoleName(roleKey)) {
          return res.status(400).json({ error: 'Cannot re-parent a system role' });
        }
        try {
          const role = await setRoleParent(roleKey, body.parentRole);
          return res.status(200).json({ role });
        } catch (error) {
          if (error instanceof RoleConflictError) {
            return res.status(400).json({ error: error.message });
          }
          if (
            error instanceof Error &&
            /does not exist|system role|different branch|not found/.test(error.message)
          ) {
            return res.status(400).json({ error: error.message });
          }
          throw error;
        }
      }

      const existing = await getRoleByName(roleKey);
      if (!existing) {
        return res.status(404).json({ error: 'Role not found' });
      }

      const trimmedName = body.name?.trim() ?? '';
      const isRename = trimmedName !== '' && trimmedName !== existing.name;

      if (isRename && isSystemRoleName(existing.name)) {
        return res.status(403).json({ error: 'Cannot rename system role' });
      }
      if (isRename && isSystemRoleName(trimmedName)) {
        return res.status(403).json({ error: 'Cannot use a reserved system role name' });
      }

      const updates: Partial<IRole> = {};
      if (isRename) {
        updates.name = trimmedName;
      }
      if (body.description !== undefined) {
        updates.description = body.description;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(200).json({ role: existing });
      }

      const role = await updateRoleByName(roleKey, updates);
      if (!role) {
        return res.status(404).json({ error: 'Role not found' });
      }
      return res.status(200).json({ role });
    } catch (error) {
      if (error instanceof RoleConflictError) {
        return res.status(409).json({ error: error.message });
      }
      logger.error('[adminRoles] updateRole error:', error);
      return res.status(500).json({ error: 'Failed to update role' });
    }
  }

  /**
   * The re-fetch via `getRoleByName` after `updateAccessPermissions` depends on the
   * callee having written the updated document to the role cache. If the cache layer
   * is refactored to stop writing from within `updateAccessPermissions`, this handler
   * must be updated to perform an explicit uncached DB read.
   */
  async function updateRolePermissionsHandler(req: ServerRequest, res: Response) {
    try {
      const { roleKey } = req.params as RoleKeyParams;
      const paramError = validateRoleKeyParam(roleKey);
      if (paramError) {
        return res.status(400).json({ error: paramError });
      }
      const { permissions } = req.body as {
        permissions: Record<string, Record<string, boolean>>;
      };

      if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
        return res.status(400).json({ error: 'permissions object is required' });
      }

      const existing = await getRoleByName(roleKey);
      if (!existing) {
        return res.status(404).json({ error: 'Role not found' });
      }

      await updateAccessPermissions(roleKey, permissions, existing);
      const updated = await getRoleByName(roleKey);
      if (!updated) {
        return res.status(404).json({ error: 'Role not found' });
      }
      return res.status(200).json({ role: updated });
    } catch (error) {
      logger.error('[adminRoles] updateRolePermissions error:', error);
      return res.status(500).json({ error: 'Failed to update role permissions' });
    }
  }

  async function deleteRoleHandler(req: ServerRequest, res: Response) {
    try {
      const { roleKey } = req.params as RoleKeyParams;
      const paramError = validateRoleKeyParam(roleKey);
      if (paramError) {
        return res.status(400).json({ error: paramError });
      }
      const existing = await getRoleByName(roleKey);
      if (!existing) {
        return res.status(404).json({ error: 'Role not found' });
      }
      if (isSystemRoleName(existing.name)) {
        return res.status(403).json({ error: 'Cannot delete system role' });
      }

      const childCount = await countChildRoles(roleKey);
      if (childCount > 0) {
        return res.status(409).json({
          error: `Cannot delete role "${existing.name}": it has ${childCount} child role(s). Re-parent or delete them first.`,
        });
      }

      const deleted = await deleteRoleByName(roleKey);
      if (!deleted) {
        return res.status(404).json({ error: 'Role not found' });
      }

      const tenantId = req.user?.tenantId;
      const [configResult, aclResult, grantsResult, unlinkResult] = await Promise.allSettled([
        deleteConfig(PrincipalType.ROLE, roleKey),
        deleteAclEntries({ principalType: PrincipalType.ROLE, principalId: roleKey }),
        deleteGrantsForPrincipal(PrincipalType.ROLE, roleKey, { tenantId }),
        clearDepartmentRootRole(roleKey, tenantId),
      ]);
      for (const result of [configResult, aclResult, grantsResult, unlinkResult]) {
        if (result.status === 'rejected') {
          logger.error('[adminRoles] cascade cleanup failed for role:', roleKey, result.reason);
        }
      }
      if (aclResult.status === 'fulfilled') {
        /** The removed entries can include PROMPTGROUP grants feeding the access cache */
        await invalidatePromptGroupAccessContext?.();
      }
      if (grantsResult.status === 'fulfilled') {
        await emitGrantRemovals(req, roleKey, existing.name, grantsResult.value);
      }
      if (unlinkResult.status === 'fulfilled' && unlinkResult.value) {
        /** This role was a department's root — the department reverts to empty
         * rather than being left pointing at a deleted role. */
        await emitDepartmentUnlinkAudit(req, unlinkResult.value, roleKey);
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof RoleConflictError) {
        return res.status(409).json({ error: error.message });
      }
      logger.error('[adminRoles] deleteRole error:', error);
      return res.status(500).json({ error: 'Failed to delete role' });
    }
  }

  async function getRoleMembersHandler(req: ServerRequest, res: Response) {
    try {
      const { roleKey } = req.params as RoleKeyParams;
      const paramError = validateRoleKeyParam(roleKey);
      if (paramError) {
        return res.status(400).json({ error: paramError });
      }
      const existing = await getRoleByName(roleKey);
      if (!existing) {
        return res.status(404).json({ error: 'Role not found' });
      }

      const { limit, offset } = parsePagination(req.query);

      const [users, total] = await Promise.all([
        listUsersByRole(roleKey, { limit, offset }),
        countUsersByRole(roleKey),
      ]);
      const members: AdminMember[] = users.map((u) => ({
        userId: u._id?.toString() ?? '',
        name: u.name ?? u._id?.toString() ?? '',
        email: u.email ?? '',
        avatarUrl: u.avatar,
      }));
      return res.status(200).json({ members, total, limit, offset });
    } catch (error) {
      logger.error('[adminRoles] getRoleMembers error:', error);
      return res.status(500).json({ error: 'Failed to get role members' });
    }
  }

  async function addRoleMemberHandler(req: ServerRequest, res: Response) {
    try {
      const { roleKey } = req.params as RoleKeyParams;
      const paramError = validateRoleKeyParam(roleKey);
      if (paramError) {
        return res.status(400).json({ error: paramError });
      }
      const { userId } = req.body as { userId: string };

      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'userId is required' });
      }
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      if (isSystemRoleName(roleKey) && roleKey !== SystemRoles.ADMIN) {
        return res.status(403).json({ error: 'Cannot directly assign members to a system role' });
      }

      const existing = await getRoleByName(roleKey);
      if (!existing) {
        return res.status(404).json({ error: 'Role not found' });
      }

      const user = await findUser({ _id: userId });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.role === roleKey) {
        return res.status(200).json({ success: true });
      }

      if (user.role === SystemRoles.ADMIN && roleKey !== SystemRoles.ADMIN) {
        const adminCount = await countUsersByRole(SystemRoles.ADMIN);
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot remove the last admin user' });
        }
      }

      const updated = await updateUser(userId, { role: roleKey });
      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.role === SystemRoles.ADMIN && roleKey !== SystemRoles.ADMIN) {
        const postCount = await countUsersByRole(SystemRoles.ADMIN);
        if (postCount === 0) {
          try {
            await updateUser(userId, { role: SystemRoles.ADMIN });
          } catch (rollbackError) {
            logger.error(
              `[adminRoles] CRITICAL: admin rollback failed in addRoleMember for user ${userId}:`,
              rollbackError,
            );
          }
          return res.status(400).json({ error: 'Cannot remove the last admin user' });
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[adminRoles] addRoleMember error:', error);
      return res.status(500).json({ error: 'Failed to add role member' });
    }
  }

  async function removeRoleMemberHandler(req: ServerRequest, res: Response) {
    try {
      const { roleKey, userId } = req.params as RoleMemberParams;
      const paramError = validateRoleKeyParam(roleKey);
      if (paramError) {
        return res.status(400).json({ error: paramError });
      }
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      if (isSystemRoleName(roleKey) && roleKey !== SystemRoles.ADMIN) {
        return res.status(403).json({ error: 'Cannot remove members from a system role' });
      }

      const existing = await getRoleByName(roleKey);
      if (!existing) {
        return res.status(404).json({ error: 'Role not found' });
      }

      const user = await findUser({ _id: userId });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.role !== roleKey) {
        return res.status(400).json({ error: 'User is not a member of this role' });
      }

      if (roleKey === SystemRoles.ADMIN) {
        const adminCount = await countUsersByRole(SystemRoles.ADMIN);
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot remove the last admin user' });
        }
      }

      const removed = await updateUser(userId, { role: SystemRoles.USER });
      if (!removed) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (roleKey === SystemRoles.ADMIN) {
        const postCount = await countUsersByRole(SystemRoles.ADMIN);
        if (postCount === 0) {
          try {
            await updateUser(userId, { role: SystemRoles.ADMIN });
          } catch (rollbackError) {
            logger.error(
              `[adminRoles] CRITICAL: admin rollback failed for user ${userId}:`,
              rollbackError,
            );
          }
          return res.status(400).json({ error: 'Cannot remove the last admin user' });
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[adminRoles] removeRoleMember error:', error);
      return res.status(500).json({ error: 'Failed to remove role member' });
    }
  }

  return {
    listRoles: listRolesHandler,
    getRole: getRoleHandler,
    createRole: createRoleHandler,
    updateRole: updateRoleHandler,
    updateRolePermissions: updateRolePermissionsHandler,
    deleteRole: deleteRoleHandler,
    getRoleMembers: getRoleMembersHandler,
    addRoleMember: addRoleMemberHandler,
    removeRoleMember: removeRoleMemberHandler,
  };
}
