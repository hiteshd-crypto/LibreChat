import type { Model } from 'mongoose';
import type { INotification } from '~/types';

export interface CreateNotificationInput {
  user: string;
  type: string;
  title: string;
  message: string;
  severity?: INotification['severity'];
  metadata?: Record<string, unknown>;
  tenantId?: string;
}

export interface NotificationMethods {
  createNotification: (input: CreateNotificationInput) => Promise<INotification>;
  listNotificationsForUser: (
    userId: string,
    options?: { limit?: number; offset?: number; unreadOnly?: boolean },
  ) => Promise<{ notifications: INotification[]; total: number }>;
  markNotificationRead: (id: string, userId: string) => Promise<INotification | null>;
  countUnreadNotifications: (userId: string) => Promise<number>;
}

export function createNotificationMethods(
  mongoose: typeof import('mongoose'),
): NotificationMethods {
  const getModel = (): Model<INotification> => mongoose.models.Notification as Model<INotification>;

  async function createNotification(input: CreateNotificationInput): Promise<INotification> {
    const Notification = getModel();
    const doc = await Notification.create({
      user: input.user,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: input.severity ?? 'info',
      metadata: input.metadata,
      tenantId: input.tenantId,
    });
    return doc.toObject();
  }

  async function listNotificationsForUser(
    userId: string,
    options: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  ): Promise<{ notifications: INotification[]; total: number }> {
    const Notification = getModel();
    const filter: Record<string, unknown> = { user: userId };
    if (options.unreadOnly) {
      filter.read = false;
    }
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean<INotification[]>(),
      Notification.countDocuments(filter),
    ]);
    return { notifications, total };
  }

  async function markNotificationRead(id: string, userId: string): Promise<INotification | null> {
    const Notification = getModel();
    return Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { read: true } },
      { new: true },
    ).lean<INotification>();
  }

  async function countUnreadNotifications(userId: string): Promise<number> {
    const Notification = getModel();
    return Notification.countDocuments({ user: userId, read: false });
  }

  return {
    createNotification,
    listNotificationsForUser,
    markNotificationRead,
    countUnreadNotifications,
  };
}
