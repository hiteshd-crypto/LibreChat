const express = require('express');
const { createAdminBalanceHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const handlers = createAdminBalanceHandlers({
  getUserById: db.getUserById,
  findBalanceByUser: db.findBalanceByUser,
  upsertBalanceFields: db.upsertBalanceFields,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/:userId', handlers.getBalance);
router.patch('/:userId', handlers.setBalance);

module.exports = router;
