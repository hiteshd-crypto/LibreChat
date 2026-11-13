import { logger, SystemCapabilities } from '@librechat/data-schemas';
import type { NextFunction, Response } from 'express';
import type { IUser } from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { HasCapabilityFn, CapabilityUser } from './capabilities';
import type { ServerRequest } from '~/types/http';

export interface HierarchyDeps {
  hasCapability: HasCapabilityFn;
  findUsers: (
    filter: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  canViewRole: (actorKey: string, targetKey: string) => Promise<boolean>;
  getDescendantRoleKeys: (roleKey: string) => Promise<string[]>;
  /** Used by `attachDepartmentScope`/`requireDepartmentRoleAccess`; from `methods/role.ts`. */
  isDescendantOf?: (childKey: string, ancestorKey: string) => Promise<boolean>;
}

type HierarchyMiddleware = (req: ServerRequest, res: Response, next: NextFunction) => Promise<void>;

function toCapabilityUser(req: ServerRequest): CapabilityUser | null {
  if (!req.user) {
    return null;
  }
  const id = req.user.id ?? req.user._id?.toString();
  if (!id) {
    return null;
  }
  return {
    id,
    role: req.user.role ?? '',
    tenantId: (req.user as CapabilityUser).tenantId,
    idOnTheSource: req.user.idOnTheSource ?? null,
  };
}

/**
 * Per-route hierarchy gates for the admin users router, layered under the
 * widened `requireAnyCapability` router gate. ADMIN and any principal holding a
 * generic `READ_USERS` grant pass through unscoped (today's behaviour); a
 * `VIEW_SUBORDINATES` holder is scoped to the strict descendants of its own role.
 */
export function createHierarchyMiddleware(deps: HierarchyDeps): {
  requireSubordinateAccess: HierarchyMiddleware;
  attachHierarchyScope: HierarchyMiddleware;
  attachDepartmentScope: HierarchyMiddleware;
  requireDepartmentRoleAccess: HierarchyMiddleware;
} {
  const { hasCapability, findUsers, canViewRole, getDescendantRoleKeys, isDescendantOf } = deps;

  const requireSubordinateAccess: HierarchyMiddleware = async (req, res, next) => {
    try {
      const user = toCapabilityUser(req);
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      if (await hasCapability(user, SystemCapabilities.ACCESS_ADMIN)) {
        next();
        return;
      }
      if (await hasCapability(user, SystemCapabilities.READ_USERS)) {
        next();
        return;
      }
      if (await hasCapability(user, SystemCapabilities.VIEW_SUBORDINATES)) {
        const { userId } = req.params as { userId?: string };
        if (!userId) {
          res.status(400).json({ error: 'userId is required' });
          return;
        }
        const [target] = await findUsers({ _id: userId }, 'role', { limit: 1 });
        if (!target) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        if (await canViewRole(user.role, target.role ?? '')) {
          next();
          return;
        }
      }
      res.status(403).json({ message: 'Forbidden' });
    } catch (err) {
      logger.error('[requireSubordinateAccess] error:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const attachHierarchyScope: HierarchyMiddleware = async (req, res, next) => {
    try {
      const user = toCapabilityUser(req);
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      const unscoped =
        (await hasCapability(user, SystemCapabilities.ACCESS_ADMIN)) ||
        (await hasCapability(user, SystemCapabilities.READ_USERS));
      if (unscoped) {
        req.hierarchyScope = null;
        next();
        return;
      }
      if (await hasCapability(user, SystemCapabilities.VIEW_SUBORDINATES)) {
        req.hierarchyScope = {
          viewableRoleKeys: await getDescendantRoleKeys(user.role),
        };
        next();
        return;
      }
      res.status(403).json({ message: 'Forbidden' });
    } catch (err) {
      logger.error('[attachHierarchyScope] error:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  /**
   * ADMIN-equivalent gates (`ACCESS_ADMIN`, `MANAGE_ROLES`, `READ_ROLES`) stay
   * unscoped — today's behaviour. A `DEPARTMENT_HEAD`-only holder gets scoped
   * to its own branch root plus its descendants, inclusive of the root itself
   * (unlike `attachHierarchyScope`'s users-list scope), since a Department
   * Head must see their own branch-root row in the Hierarchy Management tree.
   */
  const attachDepartmentScope: HierarchyMiddleware = async (req, res, next) => {
    try {
      const user = toCapabilityUser(req);
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      const unscoped =
        (await hasCapability(user, SystemCapabilities.ACCESS_ADMIN)) ||
        (await hasCapability(user, SystemCapabilities.MANAGE_ROLES)) ||
        (await hasCapability(user, SystemCapabilities.READ_ROLES));
      if (unscoped) {
        req.departmentScope = null;
        next();
        return;
      }
      if (await hasCapability(user, SystemCapabilities.DEPARTMENT_HEAD)) {
        const descendants = await getDescendantRoleKeys(user.role);
        req.departmentScope = { roleKeys: [user.role, ...descendants] };
        next();
        return;
      }
      res.status(403).json({ message: 'Forbidden' });
    } catch (err) {
      logger.error('[attachDepartmentScope] error:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  /**
   * Per-route gate for mutating role routes (`PATCH`/`DELETE /:roleKey`,
   * `PATCH /:roleKey/permissions`, member routes, and the parent-role on
   * `POST /`). ADMIN-equivalent callers pass unconditionally. A
   * `DEPARTMENT_HEAD` holder must target its own branch root or a descendant
   * of it; on create, the target is the requested `parentRole`, and a
   * `DEPARTMENT_HEAD` holder creating a top-level role (`parentRole` absent/
   * null — starting a second branch) is rejected outright. A cross-branch
   * re-parent is already rejected by `setRoleParent` itself (surfaces as a
   * 400/409), so no duplicate check is needed here for that case.
   */
  const requireDepartmentRoleAccess: HierarchyMiddleware = async (req, res, next) => {
    try {
      const user = toCapabilityUser(req);
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      const unscoped =
        (await hasCapability(user, SystemCapabilities.ACCESS_ADMIN)) ||
        (await hasCapability(user, SystemCapabilities.MANAGE_ROLES));
      if (unscoped) {
        next();
        return;
      }
      if (await hasCapability(user, SystemCapabilities.DEPARTMENT_HEAD)) {
        const isCreate = req.method === 'POST';
        if (isCreate) {
          const { parentRole } = (req.body ?? {}) as { parentRole?: string | null };
          if (parentRole == null) {
            res.status(403).json({ message: 'A Department Head cannot create a top-level role' });
            return;
          }
          if (
            parentRole === user.role ||
            (isDescendantOf && (await isDescendantOf(parentRole, user.role)))
          ) {
            next();
            return;
          }
        } else {
          const { roleKey } = req.params as { roleKey?: string };
          if (!roleKey) {
            res.status(400).json({ error: 'roleKey is required' });
            return;
          }
          if (
            roleKey === user.role ||
            (isDescendantOf && (await isDescendantOf(roleKey, user.role)))
          ) {
            next();
            return;
          }
        }
      }
      res.status(403).json({ message: 'Forbidden' });
    } catch (err) {
      logger.error('[requireDepartmentRoleAccess] error:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  return {
    requireSubordinateAccess,
    attachHierarchyScope,
    attachDepartmentScope,
    requireDepartmentRoleAccess,
  };
}
