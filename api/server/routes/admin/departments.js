const express = require('express');
const {
  createAdminDepartmentsHandlers,
  createAdminDepartmentBalanceHandlers,
} = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const {
  hasCapability,
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
const requireDeptHeadAccess = requireCapability(SystemCapabilities.DEPARTMENT_HEAD);

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

const balanceHandlers = createAdminDepartmentBalanceHandlers({
  hasCapability,
  getDepartmentById: db.getDepartmentById,
  getDepartmentForRoleKey: db.getDepartmentForRoleKey,
  getDescendantRoleKeys: db.getDescendantRoleKeys,
  findUsers: db.findUsers,
  getBalancesByUserIds: db.getBalancesByUserIds,
  getDepartmentBalance: db.getDepartmentBalance,
  incrementDepartmentBalance: db.incrementDepartmentBalance,
  checkUserOwnThreshold: db.checkUserOwnThreshold,
  commitDisbursementTransaction: db.commitDisbursementTransaction,
  commitGrantTransaction: db.commitGrantTransaction,
  recordAuditEntry: db.recordAuditEntry,
});

router.use(requireJwtAuth, requireDeptAccess);

router.get('/', requireAdminAccess, handlers.listDepartments);
router.post('/', requireAdminAccess, handlers.createDepartment);
router.get('/mine', handlers.getMyDepartment);
router.get('/mine/members', requireDeptHeadAccess, balanceHandlers.listMyMembers);
router.post('/mine/disburse/preview', requireDeptHeadAccess, balanceHandlers.previewDisburse);
router.post('/mine/disburse/confirm', requireDeptHeadAccess, balanceHandlers.confirmDisburse);
router.post('/mine/transfer/preview', requireDeptHeadAccess, balanceHandlers.previewTransfer);
router.post('/mine/transfer/confirm', requireDeptHeadAccess, balanceHandlers.confirmTransfer);
router.patch('/:departmentId/head', requireAdminAccess, handlers.setDepartmentHead);
router.patch('/:departmentId', requireAdminAccess, handlers.renameDepartment);
router.delete('/:departmentId', requireAdminAccess, handlers.deleteDepartment);
router.get('/:departmentId/balance', balanceHandlers.getBalance);
router.post('/:departmentId/grant', requireAdminAccess, balanceHandlers.grant);

module.exports = router;
