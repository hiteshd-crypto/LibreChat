import { logger } from '@librechat/data-schemas';
import type { INotification } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface NotificationsDeps {
  listNotificationsForUser: (
    userId: string,
    options?: { limit?: number; offset?: number; unreadOnly?: boolean },
  ) => Promise<{ notifications: INotification[]; total: number }>;
  markNotificationRead: (id: string, userId: string) => Promise<INotification | null>;
  countUnreadNotifications: (userId: string) => Promise<number>;
}

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

export interface NotificationsHandlers {
  list: Handler;
  unreadCount: Handler;
  markRead: Handler;
}

function requireUserId(req: ServerRequest): string | null {
  const user = req.user;
  return user?._id?.toString() ?? user?.id ?? null;
}

export function createNotificationsHandlers(deps: NotificationsDeps): NotificationsHandlers {
  const { listNotificationsForUser, markNotificationRead, countUnreadNotifications } = deps;

  async function list(req: ServerRequest, res: Response) {
    try {
      const userId = requireUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { limit, offset, unreadOnly } = req.query as {
        limit?: string;
        offset?: string;
        unreadOnly?: string;
      };
      const parsedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const parsedOffset = Math.max(Number(offset) || 0, 0);
      const result = await listNotificationsForUser(userId, {
        limit: parsedLimit,
        offset: parsedOffset,
        unreadOnly: unreadOnly === 'true',
      });
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[notifications] list error:', error);
      return res.status(500).json({ error: 'Failed to list notifications' });
    }
  }

  async function unreadCount(req: ServerRequest, res: Response) {
    try {
      const userId = requireUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const count = await countUnreadNotifications(userId);
      return res.status(200).json({ count });
    } catch (error) {
      logger.error('[notifications] unreadCount error:', error);
      return res.status(500).json({ error: 'Failed to count unread notifications' });
    }
  }

  async function markRead(req: ServerRequest, res: Response) {
    try {
      const userId = requireUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { id } = req.params as { id: string };
      const notification = await markNotificationRead(id, userId);
      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      return res.status(200).json(notification);
    } catch (error) {
      logger.error('[notifications] markRead error:', error);
      return res.status(500).json({ error: 'Failed to mark notification read' });
    }
  }

  return { list, unreadCount, markRead };
}
