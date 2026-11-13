import { SystemRoles } from 'librechat-data-provider';
import { logger, SystemCapabilities } from '@librechat/data-schemas';
import type { IDepartment } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { HasCapabilityFn, CapabilityUser } from '~/middleware/capabilities';
import type { ServerRequest } from '~/types/http';

export interface AdminHierarchyDeps {
  hasCapability: HasCapabilityFn;
  getDescendantRoleKeys: (roleKey: string) => Promise<string[]>;
  /** Resolves which Department, if any, owns the caller's own role — populates
   * `TMyHierarchy.departmentHead` for a DEPARTMENT_HEAD holder. */
  getDepartmentForRoleKey: (roleKey: string, tenantId?: string) => Promise<IDepartment | null>;
}

/**
 * Backs the frontend's `TMyHierarchy` query. Gated by `requireJwtAuth` only —
 * any authenticated user may ask "what can I see?", and the answer for a plain
 * USER is `{ isAdmin: false, canViewSubordinates: false, ...: [] }`.
 */
export function createAdminHierarchyHandlers(deps: AdminHierarchyDeps): {
  getMyHierarchy: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { hasCapability, getDescendantRoleKeys, getDepartmentForRoleKey } = deps;

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
      const canReadAuditLog = await hasCapability(
        capabilityUser,
        SystemCapabilities.READ_AUDIT_LOG,
      );
      if (isAdmin) {
        return res.status(200).json({
          isAdmin: true,
          canViewSubordinates: true,
          viewableRoleKeys: [],
          manageableRoleKeys: [],
          canReadAuditLog,
        });
      }

      const canViewSubordinates = await hasCapability(
        capabilityUser,
        SystemCapabilities.VIEW_SUBORDINATES,
      );
      const roleKeys = canViewSubordinates ? await getDescendantRoleKeys(role) : [];

      const isDepartmentHead = await hasCapability(
        capabilityUser,
        SystemCapabilities.DEPARTMENT_HEAD,
      );
      const department = isDepartmentHead
        ? await getDepartmentForRoleKey(role, capabilityUser.tenantId)
        : null;
      // DEPARTMENT_HEAD is only ever granted to a department's rootRoleKey, so a
      // department resolved for this holder's own role always has one — the
      // null check is defensive type-narrowing, not an expected runtime path.
      const departmentHead:
        | { departmentId: string; departmentName: string; rootRoleKey: string }
        | undefined =
        department && department.rootRoleKey != null
          ? {
              departmentId: String((department as unknown as { _id: unknown })._id),
              departmentName: department.name,
              rootRoleKey: department.rootRoleKey,
            }
          : undefined;

      return res.status(200).json({
        isAdmin: false,
        canViewSubordinates,
        viewableRoleKeys: roleKeys,
        manageableRoleKeys: roleKeys,
        departmentHead,
        canReadAuditLog,
      });
    } catch (error) {
      logger.error('[adminHierarchy] getMyHierarchy error:', error);
      return res.status(500).json({ error: 'Failed to resolve hierarchy access' });
    }
  }

  return { getMyHierarchy };
}
