const express = require('express');
const { createAdminDepartmentsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const {
  requireCapability,
  requireAnyCapability,
} = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireDeptAccess = requireAnyCapability([
  SystemCapabilities.ACCESS_ADMIN,
  SystemCapabilities.DEPARTMENT_HEAD,
]);

const handlers = createAdminDepartmentsHandlers({
  listDepartments: db.listDepartments,
  createDepartment: db.createDepartment,
  getDepartmentById: db.getDepartmentById,
  getDepartmentForRoleKey: db.getDepartmentForRoleKey,
  renameDepartment: db.renameDepartment,
  deleteDepartment: db.deleteDepartment,
  getDescendantRoleKeys: db.getDescendantRoleKeys,
  getRoleByName: db.getRoleByName,
  setDepartmentRootRole: db.setDepartmentRootRole,
  grantCapability: db.grantCapability,
  revokeCapability: db.revokeCapability,
  findUsers: db.findUsers,
  recordAuditEntry: db.recordAuditEntry,
});

router.use(requireJwtAuth, requireDeptAccess);

router.get('/', requireAdminAccess, handlers.listDepartments);
router.post('/', requireAdminAccess, handlers.createDepartment);
router.get('/mine', handlers.getMyDepartment);
router.patch('/:departmentId/head', requireAdminAccess, handlers.setDepartmentHead);
router.patch('/:departmentId', requireAdminAccess, handlers.renameDepartment);
router.delete('/:departmentId', requireAdminAccess, handlers.deleteDepartment);

module.exports = router;
