const express = require('express');
const { createAdminTokenDistributionHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { hasCapability, requireAnyCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

/**
 * Widened to admit DEPARTMENT_HEAD alongside ACCESS_ADMIN — see the self-only
 * guard inside `createAdminTokenDistributionHandlers`, which is what keeps a
 * DEPARTMENT_HEAD-only caller confined to acting as root-of-self.
 */
const requireDeptOrAdminAccess = requireAnyCapability([
  SystemCapabilities.ACCESS_ADMIN,
  SystemCapabilities.DEPARTMENT_HEAD,
]);

const handlers = createAdminTokenDistributionHandlers({
  hasCapability,
  getUserById: db.getUserById,
  getDescendantRoleKeys: db.getDescendantRoleKeys,
  listUsersByRoles: db.listUsersByRoles,
  getBalancesByUserIds: db.getBalancesByUserIds,
  commitGrantTransaction: db.commitGrantTransaction,
  checkUserOwnThreshold: db.checkUserOwnThreshold,
  recordAuditEntry: db.recordAuditEntry,
  /** Opt-in: fail the grant request if its audit entry can't be persisted. */
  auditFailClosed: process.env.AUDIT_LOG_FAIL_CLOSED === 'true',
});

router.use(requireJwtAuth, requireDeptOrAdminAccess);

router.get('/:rootUserId/descendants', handlers.getDescendants);
router.post('/preview', handlers.previewGrant);
router.post('/confirm', handlers.confirmGrant);

module.exports = router;
