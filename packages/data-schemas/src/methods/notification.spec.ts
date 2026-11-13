import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { IUser } from '..';
import { createNotificationMethods } from './notification';

let mongoServer: MongoMemoryReplSet;
let User: mongoose.Model<IUser>;
let methods: ReturnType<typeof createNotificationMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoServer.getUri();

  const { createModels } = await import('~/models');
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  User = mongoose.models.User;

  await mongoose.connect(mongoUri);
  methods = createNotificationMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('notification methods', () => {
  test('createNotification defaults to unread and info severity', async () => {
    const user = await User.create({ email: 'a@example.com', provider: 'local' });
    const notification = await methods.createNotification({
      user: user._id.toString(),
      type: 'spend_threshold',
      title: 'Title',
      message: 'Message',
    });
    expect(notification.read).toBe(false);
    expect(notification.severity).toBe('info');
  });

  test("listNotificationsForUser returns newest first and only this user's notifications", async () => {
    const userA = await User.create({ email: 'a@example.com', provider: 'local' });
    const userB = await User.create({ email: 'b@example.com', provider: 'local' });
    await methods.createNotification({
      user: userA._id.toString(),
      type: 't',
      title: 'first',
      message: 'm',
    });
    await methods.createNotification({
      user: userA._id.toString(),
      type: 't',
      title: 'second',
      message: 'm',
    });
    await methods.createNotification({
      user: userB._id.toString(),
      type: 't',
      title: 'other user',
      message: 'm',
    });

    const { notifications, total } = await methods.listNotificationsForUser(userA._id.toString());
    expect(total).toBe(2);
    expect(notifications.map((n) => n.title)).toEqual(['second', 'first']);
  });

  test('unreadOnly filters to unread, and markNotificationRead flips the flag', async () => {
    const user = await User.create({ email: 'a@example.com', provider: 'local' });
    const notification = await methods.createNotification({
      user: user._id.toString(),
      type: 't',
      title: 'title',
      message: 'm',
    });

    expect(await methods.countUnreadNotifications(user._id.toString())).toBe(1);

    await methods.markNotificationRead(
      (notification._id as mongoose.Types.ObjectId).toString(),
      user._id.toString(),
    );

    expect(await methods.countUnreadNotifications(user._id.toString())).toBe(0);
    const { notifications } = await methods.listNotificationsForUser(user._id.toString(), {
      unreadOnly: true,
    });
    expect(notifications).toHaveLength(0);
  });

  test("markNotificationRead cannot mark another user's notification", async () => {
    const owner = await User.create({ email: 'owner@example.com', provider: 'local' });
    const intruder = await User.create({ email: 'intruder@example.com', provider: 'local' });
    const notification = await methods.createNotification({
      user: owner._id.toString(),
      type: 't',
      title: 'title',
      message: 'm',
    });

    const result = await methods.markNotificationRead(
      (notification._id as mongoose.Types.ObjectId).toString(),
      intruder._id.toString(),
    );
    expect(result).toBeNull();
    expect(await methods.countUnreadNotifications(owner._id.toString())).toBe(1);
  });
});
