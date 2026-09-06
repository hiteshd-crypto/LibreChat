import { Types } from 'mongoose';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IRole,
  IUser,
  IConfig,
  AdminUserListItem,
  AdminUserSearchResult,
  UserDeleteResult,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';

const MAX_SEARCH_LENGTH = 200;

const USER_LIST_FIELDS = '_id name username email avatar role provider createdAt updatedAt';

export interface AdminUsersDeps {
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  countUsers: (filter?: FilterQuery<IUser>) => Promise<number>;
  /** Bulk role reassignment by user id — already invalidates the auth-user-doc cache. */
  updateUsersRoleByIds: (userIds: string[], newRole: string) => Promise<void>;
  /** Hierarchy visibility check: may `actorRole` view/manage a user with `targetRole`? */
  canViewRole: (actorRole: string, targetRole: string) => Promise<boolean>;
  /** Role-existence lookup for the reassignment endpoint's `{ role }` body. */
  getRoleByName: (name: string, fields?: string | string[] | null) => Promise<IRole | null>;
  beginAgentTriggerUserDeletion: (
    userId: string,
    startedAt: Date,
  ) => Promise<'acquired' | 'in_progress' | 'missing'>;
  cancelAgentTriggerUserDeletion: (userId: string, startedAt: Date) => Promise<boolean>;
  drainAgentTriggerDeliveriesForUser: (userId: string) => Promise<void>;
  prepareAgentTriggerUserPurge: (
    userId: string,
    fenceStartedAt: Date,
    tenantId?: string,
  ) => Promise<void>;
  cancelAgentTriggerUserPurge: (userId: string, fenceStartedAt: Date) => Promise<boolean>;
  purgeAgentTriggerDeliveriesForUser: (userId: string) => Promise<void>;
  revokeUserCodeEnvironmentWorkers?: (userId: string) => Promise<number>;
  /**
   * Thin data-layer delete — removes the User document only.
   * Full cascade of user-owned resources (conversations, messages, files, tokens, etc.)
   * is handled by `UserController.deleteUserController` in the self-delete flow.
   * This admin endpoint fences durable triggers around the user commit and currently
   * cascades Config and AclEntries.
   * A future iteration should consolidate the full cascade into a shared service function.
   */
  deleteUserById: (userId: string) => Promise<UserDeleteResult>;
  deleteUserCodeEnvironments: (userId: string | Types.ObjectId) => Promise<number>;
  invalidateCodeEnvironmentConfigCache: (tenantId?: string) => Promise<void>;
  deleteConfig: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
  ) => Promise<IConfig | null>;
  deleteAclEntries: (filter: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
  }) => Promise<void>;
}

/** Narrows a user filter to the caller's viewable role names when a hierarchy scope is set. */
function withHierarchyScope(
  filter: FilterQuery<IUser>,
  scope: ServerRequest['hierarchyScope'],
): FilterQuery<IUser> {
  if (!scope) {
    return filter;
  }
  return { ...filter, role: { $in: scope.viewableRoleNames } };
}

export function createAdminUsersHandlers(deps: AdminUsersDeps): {
  listUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  searchUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteUser: (req: ServerRequest, res: Response) => Promise<Response>;
  reassignUserRole: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findUsers,
    countUsers,
    updateUsersRoleByIds,
    canViewRole,
    getRoleByName,
    beginAgentTriggerUserDeletion,
    cancelAgentTriggerUserDeletion,
    drainAgentTriggerDeliveriesForUser,
    prepareAgentTriggerUserPurge,
    cancelAgentTriggerUserPurge,
    purgeAgentTriggerDeliveriesForUser,
    revokeUserCodeEnvironmentWorkers,
    deleteUserCodeEnvironments,
    deleteUserById,
    invalidateCodeEnvironmentConfigCache,
    deleteConfig,
    deleteAclEntries,
  } = deps;

  async function listUsersHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const filter = withHierarchyScope({}, req.hierarchyScope);
      const [users, total] = await Promise.all([
        findUsers(filter, USER_LIST_FIELDS, { limit, offset, sort: { createdAt: -1 } }),
        countUsers(filter),
      ]);

      const mapped: AdminUserListItem[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        username: u.username ?? '',
        email: u.email ?? '',
        avatar: u.avatar ?? '',
        role: u.role ?? 'USER',
        provider: u.provider ?? 'local',
        createdAt: u.createdAt?.toISOString(),
        updatedAt: u.updatedAt?.toISOString(),
      }));

      return res.status(200).json({ users: mapped, total, limit, offset });
    } catch (error) {
      logger.error('[adminUsers] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function searchUsersHandler(req: ServerRequest, res: Response) {
    try {
      const rawQ = req.query.q;
      const rawLimit = req.query.limit;
      const query = typeof rawQ === 'string' ? rawQ : undefined;
      const limitStr = typeof rawLimit === 'string' ? rawLimit : '20';
      const trimmed = query?.trim() ?? '';

      if (!trimmed) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
      }

      if (trimmed.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
      }

      if (trimmed.length > MAX_SEARCH_LENGTH) {
        return res
          .status(400)
          .json({ error: `Query must not exceed ${MAX_SEARCH_LENGTH} characters` });
      }

      const searchLimit = Math.min(Math.max(1, parseInt(limitStr, 10) || 20), 50);
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      const users = await findUsers(
        withHierarchyScope(
          { $or: [{ name: regex }, { email: regex }, { username: regex }] },
          req.hierarchyScope,
        ),
        '_id name email username avatar',
        { limit: searchLimit, sort: { name: 1 } },
      );

      const results: AdminUserSearchResult[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        email: u.email ?? '',
        username: u.username,
        avatarUrl: u.avatar,
      }));

      return res
        .status(200)
        .json({ users: results, total: results.length, capped: results.length >= searchLimit });
    } catch (error) {
      logger.error('[adminUsers] searchUsers error:', error);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  }

  async function deleteUserHandler(req: ServerRequest, res: Response) {
    let targetUserId: string | undefined;
    let triggerDeletionFence: Date | undefined;
    let userDeleted = false;

    try {
      const { id } = req.params as { id: string };
      targetUserId = id;

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (callerId === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' });
      }

      const [targetUser] = await findUsers({ _id: id }, 'role tenantId', { limit: 1 });
      if (targetUser?.role === SystemRoles.ADMIN) {
        const adminCount = await countUsers({ role: SystemRoles.ADMIN });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin user' });
        }
      }

      triggerDeletionFence = new Date();
      const fenceState = await beginAgentTriggerUserDeletion(id, triggerDeletionFence);
      if (fenceState === 'in_progress') {
        triggerDeletionFence = undefined;
        return res.status(409).json({ error: 'User deletion is already in progress' });
      }
      if (fenceState === 'missing') {
        triggerDeletionFence = undefined;
        return res.status(404).json({ error: 'User not found' });
      }
      await prepareAgentTriggerUserPurge(id, triggerDeletionFence, targetUser?.tenantId);
      await drainAgentTriggerDeliveriesForUser(id);

      const result = await deleteUserById(id);

      if (result.deletedCount === 0) {
        await cancelAgentTriggerUserPurge(id, triggerDeletionFence);
        await cancelAgentTriggerUserDeletion(id, triggerDeletionFence);
        triggerDeletionFence = undefined;
        return res.status(404).json({ error: 'User not found' });
      }
      userDeleted = true;
      let codeEnvironmentCleanupSafe = true;
      try {
        await revokeUserCodeEnvironmentWorkers?.(id);
      } catch (error) {
        codeEnvironmentCleanupSafe = false;
        logger.error('[adminUsers] failed to revoke code environment workers:', id, error);
      }
      await purgeAgentTriggerDeliveriesForUser(id);

      if (targetUser?.role === SystemRoles.ADMIN) {
        const remaining = await countUsers({ role: SystemRoles.ADMIN });
        if (remaining === 0) {
          logger.error(
            `[adminUsers] CRITICAL: last admin deleted via race condition, user: ${id}. ` +
              'Manual DB intervention required to restore an ADMIN user.',
          );
        }
      }

      const objectId = new Types.ObjectId(id);
      const cleanupResults = await Promise.allSettled([
        deleteConfig(PrincipalType.USER, id),
        ...(codeEnvironmentCleanupSafe ? [deleteUserCodeEnvironments(objectId)] : []),
        deleteAclEntries({ principalType: PrincipalType.USER, principalId: objectId }),
      ]);
      for (const r of cleanupResults) {
        if (r.status === 'rejected') {
          logger.error('[adminUsers] cascade cleanup failed for user:', id, r.reason);
        }
      }
      await invalidateCodeEnvironmentConfigCache(targetUser?.tenantId).catch((error: unknown) => {
        logger.error('[adminUsers] code environment cache invalidation failed:', id, error);
      });

      return res.status(200).json({ message: result.message || 'User deleted successfully' });
    } catch (error) {
      if (targetUserId != null && triggerDeletionFence != null && !userDeleted) {
        try {
          await cancelAgentTriggerUserPurge(targetUserId, triggerDeletionFence);
        } catch (purgeFenceError) {
          logger.error('[adminUsers] failed to disarm trigger purge recovery:', purgeFenceError);
        }
        try {
          await cancelAgentTriggerUserDeletion(targetUserId, triggerDeletionFence);
        } catch (fenceError) {
          logger.error('[adminUsers] failed to release trigger deletion fence:', fenceError);
        }
      }
      logger.error('[adminUsers] deleteUser error:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  /**
   * `PATCH /api/admin/users/:userId/role` — reassigns a user's role.
   *
   * `requireSubordinateAccess` has already proved the caller may see the
   * target's *current* role. This handler adds the second half of the two-sided
   * check: a non-ADMIN caller must also be allowed to see the *requested* role
   * (`canViewRole`), so a MANAGER can move an EMPLOYEE within its own subtree
   * but never up to its own tier or sideways into another branch. `canViewRole`
   * returns `true` for every role when the actor is ADMIN.
   */
  async function reassignUserRoleHandler(req: ServerRequest, res: Response) {
    try {
      const { userId } = req.params as { userId: string };
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const { role: requestedRole } = req.body as { role?: unknown };
      if (typeof requestedRole !== 'string' || !requestedRole.trim()) {
        return res.status(400).json({ error: 'role is required' });
      }
      const trimmedRole = requestedRole.trim();

      const actorRole = req.user?.role ?? '';
      const isAdmin = actorRole === SystemRoles.ADMIN;

      const [target, requestedRoleDoc] = await Promise.all([
        findUsers({ _id: userId }, 'role', { limit: 1 }).then((users) => users[0]),
        getRoleByName(trimmedRole),
      ]);
      if (!target) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!requestedRoleDoc) {
        return res.status(400).json({ error: `Role "${trimmedRole}" does not exist` });
      }

      if (!isAdmin) {
        const canAssign = await canViewRole(actorRole, trimmedRole);
        if (!canAssign) {
          return res.status(403).json({ error: 'Cannot assign a role outside your hierarchy' });
        }
      }

      if (target.role === SystemRoles.ADMIN && trimmedRole !== SystemRoles.ADMIN) {
        const adminCount = await countUsers({ role: SystemRoles.ADMIN });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot demote the last admin user' });
        }
      }

      await updateUsersRoleByIds([userId], trimmedRole);
      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[adminUsers] reassignUserRole error:', error);
      return res.status(500).json({ error: 'Failed to reassign role' });
    }
  }

  return {
    listUsers: listUsersHandler,
    searchUsers: searchUsersHandler,
    deleteUser: deleteUserHandler,
    reassignUserRole: reassignUserRoleHandler,
  };
}
