const express = require('express');
const mongoose = require('mongoose');
const { loadPricingCache } = require('@librechat/data-schemas');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

router.use(requireJwtAuth, requireAdminAccess);

router.post('/reload', async (req, res) => {
  try {
    await loadPricingCache(mongoose);
    res.json({ success: true, message: 'Pricing cache reloaded from MongoDB.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
