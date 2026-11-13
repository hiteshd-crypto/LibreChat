const express = require('express');
const { createAdminRolesHandlers, createHierarchyMiddleware } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { hasCapability, requireAnyCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

/**
 * Widened from ACCESS_ADMIN-only so a DEPARTMENT_HEAD holder can reach this
 * router at all; `attachDepartmentScope`/`requireDepartmentRoleAccess` below
 * are what actually confine them to their own branch.
 */
const requireAdminOrDeptAccess = requireAnyCapability([
  SystemCapabilities.ACCESS_ADMIN,
  SystemCapabilities.DEPARTMENT_HEAD,
]);
const requireReadRoles = requireAnyCapability([
  SystemCapabilities.READ_ROLES,
  SystemCapabilities.DEPARTMENT_HEAD,
]);
const requireManageRoles = requireAnyCapability([
  SystemCapabilities.MANAGE_ROLES,
  SystemCapabilities.DEPARTMENT_HEAD,
]);

const { attachDepartmentScope, requireDepartmentRoleAccess } = createHierarchyMiddleware({
  hasCapability,
  findUsers: db.findUsers,
  canViewRole: db.canViewRole,
  getDescendantRoleKeys: db.getDescendantRoleKeys,
  isDescendantOf: db.isDescendantOf,
});

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
  getDepartmentById: db.getDepartmentById,
  setDepartmentRootRole: db.setDepartmentRootRole,
  clearDepartmentRootRole: db.clearDepartmentRootRole,
});

router.use(requireJwtAuth, requireAdminOrDeptAccess);

router.get('/', requireReadRoles, attachDepartmentScope, handlers.listRoles);
router.post('/', requireManageRoles, requireDepartmentRoleAccess, handlers.createRole);
router.get('/:roleKey', requireReadRoles, attachDepartmentScope, handlers.getRole);
router.patch('/:roleKey', requireManageRoles, requireDepartmentRoleAccess, handlers.updateRole);
router.delete('/:roleKey', requireManageRoles, requireDepartmentRoleAccess, handlers.deleteRole);
router.patch(
  '/:roleKey/permissions',
  requireManageRoles,
  requireDepartmentRoleAccess,
  handlers.updateRolePermissions,
);
router.get(
  '/:roleKey/members',
  requireReadRoles,
  requireDepartmentRoleAccess,
  handlers.getRoleMembers,
);
router.post(
  '/:roleKey/members',
  requireManageRoles,
  requireDepartmentRoleAccess,
  handlers.addRoleMember,
);
router.delete(
  '/:roleKey/members/:userId',
  requireManageRoles,
  requireDepartmentRoleAccess,
  handlers.removeRoleMember,
);

module.exports = router;
