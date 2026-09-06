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
  canViewRole: (actorRole: string, targetRole: string) => Promise<boolean>;
  getDescendantRoleNames: (roleName: string) => Promise<string[]>;
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
} {
  const { hasCapability, findUsers, canViewRole, getDescendantRoleNames } = deps;

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
          viewableRoleNames: await getDescendantRoleNames(user.role),
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

  return { requireSubordinateAccess, attachHierarchyScope };
}
