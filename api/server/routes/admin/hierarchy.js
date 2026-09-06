const express = require('express');
const { createAdminHierarchyHandlers } = require('@librechat/api');
const { hasCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const handlers = createAdminHierarchyHandlers({
  hasCapability,
  getDescendantRoleNames: db.getDescendantRoleNames,
});

router.use(requireJwtAuth);
router.get('/me', handlers.getMyHierarchy);

module.exports = router;
