import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import {
  logger,
  SystemCapabilities,
  DepartmentConflictError,
  RoleConflictError,
} from '@librechat/data-schemas';
import type {
  IRole,
  IUser,
  IDepartment,
  ISystemGrant,
  SystemCapability,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { buildAuditContext } from './context';

const MAX_NAME_LENGTH = 500;
const CONTROL_CHAR_RE = /\p{Cc}/u;

function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) {
    return 'name is required';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `name must not exceed ${MAX_NAME_LENGTH} characters`;
  }
  if (CONTROL_CHAR_RE.test(name)) {
    return 'name contains invalid characters';
  }
  return null;
}

const systemRoleValues = new Set<string>(Object.values(SystemRoles));

/** Case-insensitive check — mirrors `admin/roles.ts`'s `isSystemRoleName`. */
function isSystemRoleName(name: string): boolean {
  return systemRoleValues.has(name.toUpperCase());
}

export interface AdminDepartmentsDeps {
  listDepartments: (options?: { tenantId?: string }) => Promise<IDepartment[]>;
  createDepartment: (input: {
    name: string;
    /** Omitted to create an empty department; set to wrap an existing top-level branch. */
    rootRoleKey?: string;
    tenantId?: string;
  }) => Promise<IDepartment>;
  getDepartmentById: (departmentId: string, tenantId?: string) => Promise<IDepartment | null>;
  getDepartmentForRoleKey: (roleKey: string, tenantId?: string) => Promise<IDepartment | null>;
  renameDepartment: (departmentId: string, name: string, tenantId?: string) => Promise<IDepartment>;
  deleteDepartment: (departmentId: string, tenantId?: string) => Promise<IDepartment | null>;
  getDescendantRoleKeys: (roleKey: string) => Promise<string[]>;
  getRoleByName: (name: string, fields?: string | string[] | null) => Promise<IRole | null>;
  /** Atomically claims an empty department's root role; `null` means the
   * department doesn't exist or already has one (lost a race). */
  setDepartmentRootRole: (
    departmentId: string,
    rootRoleKey: string,
    tenantId?: string,
  ) => Promise<IDepartment | null>;
  grantCapability: (params: {
    principalType: PrincipalType;
    principalId: string;
    capability: SystemCapability;
    tenantId?: string;
  }) => Promise<{ grant: ISystemGrant | null; created: boolean }>;
  /** Used on delete to clean up the branch root's DEPARTMENT_HEAD grant so no
   * dangling scoped-admin access survives the department being un-wrapped. */
  revokeCapability: (params: {
    principalType: PrincipalType;
    principalId: string;
    capability: SystemCapability;
    tenantId?: string;
  }) => Promise<{ deletedCount: number }>;
  findUsers: (
    filter: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  recordAuditEntry?: (
    input: RecordAuditEntryInput,
    options?: RecordAuditEntryOptions,
  ) => Promise<void>;
}

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

export interface AdminDepartmentsHandlers {
  listDepartments: Handler;
  createDepartment: Handler;
  getMyDepartment: Handler;
  setDepartmentHead: Handler;
  renameDepartment: Handler;
  deleteDepartment: Handler;
}

export function createAdminDepartmentsHandlers(
  deps: AdminDepartmentsDeps,
): AdminDepartmentsHandlers {
  const {
    listDepartments,
    createDepartment,
    getDepartmentById,
    getDepartmentForRoleKey,
    renameDepartment,
    deleteDepartment,
    getDescendantRoleKeys,
    getRoleByName,
    setDepartmentRootRole,
    grantCapability,
    revokeCapability,
    findUsers,
    recordAuditEntry,
  } = deps;

  async function emitDepartmentAudit(
    req: ServerRequest,
    action: 'department.created' | 'department.deleted' | 'department.head_assigned',
    department: Pick<IDepartment, 'name'> & { rootRoleKey: string },
  ): Promise<void> {
    if (!recordAuditEntry) return;
    const user = req.user;
    const userId = user?._id?.toString() ?? user?.id;
    if (!user || !userId) return;
    const actorName = user.name || user.username || user.email || userId;
    try {
      await recordAuditEntry({
        action,
        outcome: 'success',
        actor: { type: 'user', id: userId, name: actorName },
        target: {
          type: PrincipalType.ROLE,
          id: department.rootRoleKey,
          name: department.name,
        },
        metadata: { capability: SystemCapabilities.DEPARTMENT_HEAD },
        context: buildAuditContext(req),
        tenantId: user.tenantId,
      });
    } catch (err) {
      logger.error(`[adminDepartments] ${action} audit failed`, err);
    }
  }

  /** Users holding the department's root role or any role beneath it — the
   * population a delete would leave label-less, surfaced so the Super Admin
   * can see the cascading impact before confirming. */
  async function countDepartmentMembers(rootRoleKey: string | null): Promise<number> {
    if (rootRoleKey == null) {
      return 0;
    }
    const descendantRoleKeys = await getDescendantRoleKeys(rootRoleKey);
    const members = await findUsers({ role: { $in: [rootRoleKey, ...descendantRoleKeys] } }, '_id');
    return members.length;
  }

  async function listDepartmentsHandler(req: ServerRequest, res: Response) {
    try {
      const departments = await listDepartments({ tenantId: req.user?.tenantId });
      const withMemberCounts = await Promise.all(
        departments.map(async (department) => ({
          ...department,
          memberCount: await countDepartmentMembers(department.rootRoleKey),
        })),
      );
      return res.status(200).json({ departments: withMemberCounts });
    } catch (error) {
      logger.error('[adminDepartments] listDepartments error:', error);
      return res.status(500).json({ error: 'Failed to list departments' });
    }
  }

  /**
   * Creates a Department. Omitting `rootRoleKey` creates a completely empty
   * department — no role is minted, nothing is granted. The Super Admin
   * establishes the real Department Head role afterward from inside the
   * empty department's tree view (the top-level "Create role" action, see
   * `createRoleHandler`'s `departmentId` handling in `admin/roles.ts`), which
   * is the only thing that ever links a role back to the department and
   * grants it `DEPARTMENT_HEAD`. `rootRoleKey` remains available to wrap an
   * existing top-level branch directly (used by `migrateDepartments`).
   */
  async function createDepartmentHandler(req: ServerRequest, res: Response) {
    try {
      const { name, rootRoleKey } = req.body as {
        name?: string;
        rootRoleKey?: string;
      };
      const nameError = validateName(name);
      if (nameError) {
        return res.status(400).json({ error: nameError });
      }

      const tenantId = req.user?.tenantId;
      const department = await createDepartment({
        name: (name as string).trim(),
        rootRoleKey,
        tenantId,
      });

      if (department.rootRoleKey != null) {
        await grantCapability({
          principalType: PrincipalType.ROLE,
          principalId: department.rootRoleKey,
          capability: SystemCapabilities.DEPARTMENT_HEAD,
          tenantId,
        });
        await emitDepartmentAudit(req, 'department.created', {
          name: department.name,
          rootRoleKey: department.rootRoleKey,
        });
      }

      return res.status(201).json({ department });
    } catch (error) {
      if (error instanceof DepartmentConflictError || error instanceof RoleConflictError) {
        return res.status(409).json({ error: error.message });
      }
      if (
        error instanceof Error &&
        /does not exist|not a top-level branch root/.test(error.message)
      ) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('[adminDepartments] createDepartment error:', error);
      return res.status(500).json({ error: 'Failed to create department' });
    }
  }

  /** Client only calls this when `TMyHierarchy.departmentHead` is set; 404 if the
   * caller's role isn't inside any department. */
  async function getMyDepartmentHandler(req: ServerRequest, res: Response) {
    try {
      const user = req.user;
      if (!user?.role) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const department = await getDepartmentForRoleKey(user.role, user.tenantId);
      if (!department) {
        return res.status(404).json({ error: 'Not a member of any department' });
      }
      return res.status(200).json({ department });
    } catch (error) {
      logger.error('[adminDepartments] getMyDepartment error:', error);
      return res.status(500).json({ error: 'Failed to resolve department' });
    }
  }

  /**
   * Wraps an existing top-level role as an already-created, still-empty
   * department's head. This is the explicit counterpart to the implicit
   * `departmentId`-linking path in `createRoleHandler` (`admin/roles.ts`),
   * which only fires when the role is minted at the same moment as the link —
   * every role created afterward (a child role, or one added before the
   * department existed) had no way to become a head without this endpoint.
   */
  async function setDepartmentHeadHandler(req: ServerRequest, res: Response) {
    try {
      const { departmentId } = req.params as { departmentId: string };
      const { roleKey } = req.body as { roleKey?: string };
      if (!roleKey || typeof roleKey !== 'string') {
        return res.status(400).json({ error: 'roleKey is required' });
      }

      const tenantId = req.user?.tenantId;
      const department = await getDepartmentById(departmentId, tenantId);
      if (!department) {
        return res.status(404).json({ error: 'Department not found' });
      }
      if (department.rootRoleKey != null) {
        return res.status(409).json({ error: 'Department already has a head' });
      }

      const role = await getRoleByName(roleKey);
      if (!role) {
        return res.status(404).json({ error: `Role "${roleKey}" does not exist` });
      }
      if (isSystemRoleName(role.name)) {
        return res.status(400).json({ error: 'roleKey cannot be a system role' });
      }
      if (role.parentRole != null) {
        return res.status(400).json({ error: 'roleKey must be a top-level role' });
      }

      const existingDepartment = await getDepartmentForRoleKey(roleKey, tenantId);
      if (existingDepartment) {
        return res
          .status(409)
          .json({ error: 'That role is already the head of another department' });
      }

      const linked = await setDepartmentRootRole(departmentId, roleKey, tenantId);
      if (!linked) {
        return res.status(409).json({ error: 'Department already has a head' });
      }

      await grantCapability({
        principalType: PrincipalType.ROLE,
        principalId: roleKey,
        capability: SystemCapabilities.DEPARTMENT_HEAD,
        tenantId,
      });
      await emitDepartmentAudit(req, 'department.head_assigned', {
        name: linked.name,
        rootRoleKey: roleKey,
      });

      return res.status(200).json({ department: linked });
    } catch (error) {
      logger.error('[adminDepartments] setDepartmentHead error:', error);
      return res.status(500).json({ error: 'Failed to set department head' });
    }
  }

  async function renameDepartmentHandler(req: ServerRequest, res: Response) {
    try {
      const { departmentId } = req.params as { departmentId: string };
      const { name } = req.body as { name?: string };
      const nameError = validateName(name);
      if (nameError) {
        return res.status(400).json({ error: nameError });
      }
      const department = await renameDepartment(
        departmentId,
        (name as string).trim(),
        req.user?.tenantId,
      );
      return res.status(200).json({ department });
    } catch (error) {
      if (error instanceof DepartmentConflictError) {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof Error && /not found/.test(error.message)) {
        return res.status(404).json({ error: error.message });
      }
      logger.error('[adminDepartments] renameDepartment error:', error);
      return res.status(500).json({ error: 'Failed to rename department' });
    }
  }

  /** Deletes the Department label and revokes the DEPARTMENT_HEAD grant from its
   * root role (so no dangling scoped-admin access survives). The underlying Role
   * branch and its members are untouched — nothing is reassigned or deleted. */
  async function deleteDepartmentHandler(req: ServerRequest, res: Response) {
    try {
      const { departmentId } = req.params as { departmentId: string };
      const deleted = await deleteDepartment(departmentId, req.user?.tenantId);
      if (!deleted) {
        return res.status(404).json({ error: 'Department not found' });
      }
      if (deleted.rootRoleKey != null) {
        const rootRoleKey = deleted.rootRoleKey;
        try {
          await revokeCapability({
            principalType: PrincipalType.ROLE,
            principalId: rootRoleKey,
            capability: SystemCapabilities.DEPARTMENT_HEAD,
            tenantId: req.user?.tenantId,
          });
        } catch (err) {
          logger.error(
            '[adminDepartments] revokeCapability failed during department deletion',
            err,
          );
        }
        await emitDepartmentAudit(req, 'department.deleted', { name: deleted.name, rootRoleKey });
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[adminDepartments] deleteDepartment error:', error);
      return res.status(500).json({ error: 'Failed to delete department' });
    }
  }

  return {
    listDepartments: listDepartmentsHandler,
    createDepartment: createDepartmentHandler,
    getMyDepartment: getMyDepartmentHandler,
    setDepartmentHead: setDepartmentHeadHandler,
    renameDepartment: renameDepartmentHandler,
    deleteDepartment: deleteDepartmentHandler,
  };
}
