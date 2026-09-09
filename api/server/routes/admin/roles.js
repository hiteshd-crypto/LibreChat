const express = require('express');
const { createAdminRolesHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadRoles = requireCapability(SystemCapabilities.READ_ROLES);
const requireManageRoles = requireCapability(SystemCapabilities.MANAGE_ROLES);

const handlers = createAdminRolesHandlers({
  listRoles: db.listRoles,
  countRoles: db.countRoles,
  getRoleByName: db.getRoleByName,
  createRoleByName: db.createRoleByName,
  updateRoleByName: db.updateRoleByName,
  updateAccessPermissions: db.updateAccessPermissions,
  deleteRoleByName: db.deleteRoleByName,
  setRoleParent: db.setRoleParent,
  countChildRoles: db.countChildRoles,
  grantCapability: db.grantCapability,
  findUser: db.findUser,
  updateUser: db.updateUser,
  listUsersByRole: db.listUsersByRole,
  countUsersByRole: db.countUsersByRole,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  deleteGrantsForPrincipal: db.deleteGrantsForPrincipal,
  recordAuditEntry: db.recordAuditEntry,
  invalidatePromptGroupAccessContext: db.invalidatePromptGroupAccessContext,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadRoles, handlers.listRoles);
router.post('/', requireManageRoles, handlers.createRole);
router.get('/:roleKey', requireReadRoles, handlers.getRole);
router.patch('/:roleKey', requireManageRoles, handlers.updateRole);
router.delete('/:roleKey', requireManageRoles, handlers.deleteRole);
router.patch('/:roleKey/permissions', requireManageRoles, handlers.updateRolePermissions);
router.get('/:roleKey/members', requireReadRoles, handlers.getRoleMembers);
router.post('/:roleKey/members', requireManageRoles, handlers.addRoleMember);
router.delete('/:roleKey/members/:userId', requireManageRoles, handlers.removeRoleMember);

module.exports = router;
