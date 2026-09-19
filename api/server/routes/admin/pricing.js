const express = require('express');
const mongoose = require('mongoose');
const { createAdminPricingHandlers } = require('@librechat/api');
const { loadPricingCache, SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const handlers = createAdminPricingHandlers({
  listStandardPricingRates: db.listStandardPricingRates,
  createStandardPricingRate: db.createStandardPricingRate,
  updateStandardPricingRate: db.updateStandardPricingRate,
  deleteStandardPricingRate: db.deleteStandardPricingRate,
  reloadPricingCache: () => loadPricingCache(mongoose),
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', handlers.listRates);
router.post('/', handlers.createRate);
router.patch('/:modelKey', handlers.updateRate);
router.delete('/:modelKey', handlers.deleteRate);

router.post('/reload', async (req, res) => {
  try {
    await loadPricingCache(mongoose);
    res.json({ success: true, message: 'Pricing cache reloaded from MongoDB.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
