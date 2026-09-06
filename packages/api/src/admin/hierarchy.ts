import { SystemRoles } from 'librechat-data-provider';
import { logger, SystemCapabilities } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { HasCapabilityFn, CapabilityUser } from '~/middleware/capabilities';
import type { ServerRequest } from '~/types/http';

export interface AdminHierarchyDeps {
  hasCapability: HasCapabilityFn;
  getDescendantRoleNames: (roleName: string) => Promise<string[]>;
}

/**
 * Backs the frontend's `TMyHierarchy` query. Gated by `requireJwtAuth` only —
 * any authenticated user may ask "what can I see?", and the answer for a plain
 * USER is `{ isAdmin: false, canViewSubordinates: false, ...: [] }`.
 */
export function createAdminHierarchyHandlers(deps: AdminHierarchyDeps): {
  getMyHierarchy: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { hasCapability, getDescendantRoleNames } = deps;

  async function getMyHierarchy(req: ServerRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      const id = req.user.id ?? req.user._id?.toString() ?? '';
      const role = req.user.role ?? '';
      const capabilityUser: CapabilityUser = {
        id,
        role,
        tenantId: (req.user as CapabilityUser).tenantId,
        idOnTheSource: req.user.idOnTheSource ?? null,
      };

      const isAdmin =
        role === SystemRoles.ADMIN ||
        (await hasCapability(capabilityUser, SystemCapabilities.ACCESS_ADMIN));
      if (isAdmin) {
        return res.status(200).json({
          isAdmin: true,
          canViewSubordinates: true,
          viewableRoleNames: [],
          manageableRoleNames: [],
        });
      }

      const canViewSubordinates = await hasCapability(
        capabilityUser,
        SystemCapabilities.VIEW_SUBORDINATES,
      );
      const roleNames = canViewSubordinates ? await getDescendantRoleNames(role) : [];

      return res.status(200).json({
        isAdmin: false,
        canViewSubordinates,
        viewableRoleNames: roleNames,
        manageableRoleNames: roleNames,
      });
    } catch (error) {
      logger.error('[adminHierarchy] getMyHierarchy error:', error);
      return res.status(500).json({ error: 'Failed to resolve hierarchy access' });
    }
  }

  return { getMyHierarchy };
}
