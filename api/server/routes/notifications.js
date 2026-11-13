const express = require('express');
const { createNotificationsHandlers } = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const handlers = createNotificationsHandlers({
  listNotificationsForUser: db.listNotificationsForUser,
  markNotificationRead: db.markNotificationRead,
  countUnreadNotifications: db.countUnreadNotifications,
});

router.use(requireJwtAuth);

router.get('/', handlers.list);
router.get('/unread-count', handlers.unreadCount);
router.patch('/:id/read', handlers.markRead);

module.exports = router;
