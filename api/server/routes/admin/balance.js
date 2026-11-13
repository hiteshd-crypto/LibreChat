const express = require('express');
const { createAdminBalanceHandlers } = require('@librechat/api');
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
const requireAdminOrDeptAccess = requireAnyCapability([
  SystemCapabilities.ACCESS_ADMIN,
  SystemCapabilities.DEPARTMENT_HEAD,
]);

const handlers = createAdminBalanceHandlers({
  hasCapability,
  getUserById: db.getUserById,
  findBalanceByUser: db.findBalanceByUser,
  upsertBalanceFields: db.upsertBalanceFields,
  setBalanceIfUnchanged: db.setBalanceIfUnchanged,
  isDescendantOf: db.isDescendantOf,
  recordAuditEntry: db.recordAuditEntry,
});

router.use(requireJwtAuth, requireAdminOrDeptAccess);

// A Department Head may only ever view (never edit) a balance, and only within
// their own department — see getBalanceHandler's self-or-descendant check.
router.get('/:userId', handlers.getBalance);
router.patch('/:userId', requireAdminAccess, handlers.setBalance);

module.exports = router;
