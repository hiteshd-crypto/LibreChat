const express = require('express');
const mongoose = require('mongoose');
const {
  createAdminUsersHandlers,
  createAdminUserConversationsHandlers,
  createHierarchyMiddleware,
  revokeUserCodeEnvironmentWorkers,
} = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { hasCapability, requireAnyCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const {
  drainAgentTriggerDeliveriesForUser,
  prepareAgentTriggerUserPurge,
  cancelAgentTriggerUserPurge,
  purgeAgentTriggerDeliveriesForUser,
} = require('~/server/services/Agents/triggers');
const db = require('~/models');
const { getAppConfig, invalidateCodeEnvironmentConfigCache } = require('~/server/services/Config');

const router = express.Router();

/**
 * Router gate widened from ACCESS_ADMIN-only so a hierarchy role holding
 * VIEW_SUBORDINATES can reach the per-route hierarchy middleware below. The
 * Access (roles) router stays strictly ACCESS_ADMIN-gated.
 */
const requireAdminOrHierarchyAccess = requireAnyCapability([
  SystemCapabilities.ACCESS_ADMIN,
  SystemCapabilities.READ_USERS,
  SystemCapabilities.VIEW_SUBORDINATES,
]);
// const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const { requireSubordinateAccess, attachHierarchyScope } = createHierarchyMiddleware({
  hasCapability,
  findUsers: db.findUsers,
  canViewRole: db.canViewRole,
  getDescendantRoleKeys: db.getDescendantRoleKeys,
});

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  updateUsersRoleByIds: db.updateUsersRoleByIds,
  canViewRole: db.canViewRole,
  getRoleByName: db.getRoleByName,
  beginAgentTriggerUserDeletion: db.beginAgentTriggerUserDeletion,
  cancelAgentTriggerUserDeletion: db.cancelAgentTriggerUserDeletion,
  drainAgentTriggerDeliveriesForUser,
  prepareAgentTriggerUserPurge,
  cancelAgentTriggerUserPurge,
  purgeAgentTriggerDeliveriesForUser,
  revokeUserCodeEnvironmentWorkers: async (userId) =>
    revokeUserCodeEnvironmentWorkers({
      mongoose,
      userId,
      appConfig: await getAppConfig({ baseOnly: true }),
    }),
  deleteUserById: db.deleteUserById,
  deleteUserCodeEnvironments: db.deleteUserCodeEnvironments,
  invalidateCodeEnvironmentConfigCache,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
});

const conversationHandlers = createAdminUserConversationsHandlers({
  findUsers: db.findUsers,
  getConvosByCursor: db.getConvosByCursor,
  getConvo: db.getConvo,
  getMessages: db.getMessages,
});

router.use(requireJwtAuth, requireAdminOrHierarchyAccess);

router.get('/', attachHierarchyScope, handlers.listUsers);
router.get('/search', attachHierarchyScope, handlers.searchUsers);
// router.delete('/:id', requireManageUsers, handlers.deleteUser);

router.get(
  '/:userId/conversations',
  requireSubordinateAccess,
  conversationHandlers.listUserConversations,
);
router.get(
  '/:userId/conversations/:conversationId',
  requireSubordinateAccess,
  conversationHandlers.getUserConversation,
);
router.get(
  '/:userId/conversations/:conversationId/messages',
  requireSubordinateAccess,
  conversationHandlers.getUserConversationMessages,
);
router.patch('/:userId/role', requireSubordinateAccess, handlers.reassignUserRole);

module.exports = router;
