import type { INotification } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { NotificationsDeps } from './notifications';
import type { ServerRequest } from '~/types/http';
import { createNotificationsHandlers } from './notifications';

function createReqRes(overrides: Partial<ServerRequest> = {}) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  const req = {
    user: { _id: 'user-1' },
    query: {},
    params: {},
    ...overrides,
  } as unknown as ServerRequest;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<NotificationsDeps> = {}): NotificationsDeps {
  return {
    listNotificationsForUser: jest.fn().mockResolvedValue({ notifications: [], total: 0 }),
    markNotificationRead: jest.fn().mockResolvedValue({ _id: 'n1' } as unknown as INotification),
    countUnreadNotifications: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('createNotificationsHandlers', () => {
  describe('list', () => {
    it('401s when there is no authenticated user', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ user: undefined });
      await createNotificationsHandlers(deps).list(req, res);
      expect(status).toHaveBeenCalledWith(401);
    });

    it("lists the caller's own notifications with parsed pagination", async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({
        query: { limit: '5', offset: '10', unreadOnly: 'true' },
      });
      await createNotificationsHandlers(deps).list(req, res);
      expect(deps.listNotificationsForUser).toHaveBeenCalledWith('user-1', {
        limit: 5,
        offset: 10,
        unreadOnly: true,
      });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ notifications: [], total: 0 });
    });
  });

  describe('unreadCount', () => {
    it("returns the caller's unread count", async () => {
      const deps = createDeps({ countUnreadNotifications: jest.fn().mockResolvedValue(3) });
      const { req, res, json } = createReqRes();
      await createNotificationsHandlers(deps).unreadCount(req, res);
      expect(deps.countUnreadNotifications).toHaveBeenCalledWith('user-1');
      expect(json).toHaveBeenCalledWith({ count: 3 });
    });
  });

  describe('markRead', () => {
    it('404s when the notification does not exist or belongs to someone else', async () => {
      const deps = createDeps({ markNotificationRead: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({ params: { id: 'n1' } });
      await createNotificationsHandlers(deps).markRead(req, res);
      expect(status).toHaveBeenCalledWith(404);
    });

    it("marks the caller's own notification read", async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ params: { id: 'n1' } });
      await createNotificationsHandlers(deps).markRead(req, res);
      expect(deps.markNotificationRead).toHaveBeenCalledWith('n1', 'user-1');
      expect(status).toHaveBeenCalledWith(200);
    });
  });
});
