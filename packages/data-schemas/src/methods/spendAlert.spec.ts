import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { IBalance, IUser } from '..';
import { createNotificationMethods } from './notification';
import { createSpendAlertMethods } from './spendAlert';
import { createBalanceMethods } from './balance';
import { createUserMethods } from './user';

let mongoServer: MongoMemoryReplSet;
let Balance: mongoose.Model<IBalance>;
let User: mongoose.Model<IUser>;
let spendAlert: ReturnType<typeof createSpendAlertMethods>;
let commitGrantTransaction: ReturnType<typeof createBalanceMethods>['commitGrantTransaction'];
let getBalanceRecord: ReturnType<typeof createBalanceMethods>['getBalanceRecord'];
let listNotificationsForUser: ReturnType<
  typeof createNotificationMethods
>['listNotificationsForUser'];

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoServer.getUri();

  const { createModels } = await import('~/models');
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  Balance = mongoose.models.Balance;
  User = mongoose.models.User;

  await mongoose.connect(mongoUri);

  const balanceMethods = createBalanceMethods(mongoose);
  ({ commitGrantTransaction, getBalanceRecord } = balanceMethods);

  const notificationMethods = createNotificationMethods(mongoose);
  ({ listNotificationsForUser } = notificationMethods);

  const userMethods = createUserMethods(mongoose);

  spendAlert = createSpendAlertMethods({
    findUsers: userMethods.findUsers,
    getBalanceRecord: balanceMethods.getBalanceRecord,
    setUserAlertLevel: balanceMethods.setUserAlertLevel,
    createNotification: notificationMethods.createNotification,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('checkUserOwnThreshold', () => {
  test('does nothing when the member has never received anything', async () => {
    const member = await User.create({ email: 'nobody@example.com', provider: 'local' });
    await spendAlert.checkUserOwnThreshold(member._id.toString());

    const { notifications } = await listNotificationsForUser(member._id.toString());
    expect(notifications).toHaveLength(0);
  });

  test('notifies only the member themself once spend crosses 80%, and again at 100% — never their department head', async () => {
    const head = await User.create({
      email: 'sales-head@example.com',
      role: 'SALES_HEAD',
      provider: 'local',
    });
    const member = await User.create({
      email: 'member@example.com',
      role: 'SALES_HEAD',
      provider: 'local',
    });
    // Disburse 100 to the member (new money, bumps totalReceived).
    await commitGrantTransaction([
      { userId: member._id.toString(), expectedBalance: 0, newBalance: 100 },
    ]);

    // Spend down to 25 remaining (75% used) — no alert yet.
    await Balance.findOneAndUpdate({ user: member._id }, { tokenCredits: 25 });
    await spendAlert.checkUserOwnThreshold(member._id.toString());
    expect((await listNotificationsForUser(member._id.toString())).notifications).toHaveLength(0);
    expect((await listNotificationsForUser(head._id.toString())).notifications).toHaveLength(0);

    // Spend down to 15 remaining (85% used) — crosses 80%.
    await Balance.findOneAndUpdate({ user: member._id }, { tokenCredits: 15 });
    await spendAlert.checkUserOwnThreshold(member._id.toString());
    const memberAfter80 = await listNotificationsForUser(member._id.toString());
    expect(memberAfter80.notifications).toHaveLength(1);
    expect(memberAfter80.notifications[0].type).toBe('spend_threshold');
    expect(memberAfter80.notifications[0].metadata).toMatchObject({ level: 80 });
    expect((await listNotificationsForUser(head._id.toString())).notifications).toHaveLength(0);

    // Spend to 0 — crosses 100%.
    await Balance.findOneAndUpdate({ user: member._id }, { tokenCredits: 0 });
    await spendAlert.checkUserOwnThreshold(member._id.toString());
    expect((await listNotificationsForUser(member._id.toString())).notifications).toHaveLength(2);
    expect((await listNotificationsForUser(head._id.toString())).notifications).toHaveLength(0);
  });

  test('a department head spending their own share gets their own notification, same as any member', async () => {
    const head = await User.create({
      email: 'ops-head@example.com',
      role: 'OPS_HEAD',
      provider: 'local',
    });
    await commitGrantTransaction([
      { userId: head._id.toString(), expectedBalance: 0, newBalance: 100 },
    ]);
    await Balance.findOneAndUpdate({ user: head._id }, { tokenCredits: 0 });

    await spendAlert.checkUserOwnThreshold(head._id.toString());

    const { notifications } = await listNotificationsForUser(head._id.toString());
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('spend_threshold');
  });

  test('a fresh disbursement self-heals lastAlertLevel so a later re-cross alerts again', async () => {
    const member = await User.create({ email: 'fresh@example.com', provider: 'local' });
    await commitGrantTransaction([
      { userId: member._id.toString(), expectedBalance: 0, newBalance: 100 },
    ]);
    await Balance.findOneAndUpdate({ user: member._id }, { tokenCredits: 0 });
    await spendAlert.checkUserOwnThreshold(member._id.toString());
    expect((await listNotificationsForUser(member._id.toString())).notifications).toHaveLength(1);

    // Top back up well above 80% remaining — lastAlertLevel resets to 0.
    const record = await getBalanceRecord(member._id.toString());
    await commitGrantTransaction([
      { userId: member._id.toString(), expectedBalance: record.tokenCredits, newBalance: 1000 },
    ]);
    await spendAlert.checkUserOwnThreshold(member._id.toString());
    expect((await getBalanceRecord(member._id.toString())).lastAlertLevel).toBe(0);

    // Spend back down past 100% — alerts again.
    await Balance.findOneAndUpdate({ user: member._id }, { tokenCredits: 0 });
    await spendAlert.checkUserOwnThreshold(member._id.toString());
    expect((await listNotificationsForUser(member._id.toString())).notifications).toHaveLength(2);
  });

  test('the sending side of a transfer can also cross its own threshold', async () => {
    const sender = await User.create({ email: 'sender@example.com', provider: 'local' });
    const recipient = await User.create({ email: 'recipient@example.com', provider: 'local' });
    await commitGrantTransaction([
      { userId: sender._id.toString(), expectedBalance: 0, newBalance: 100 },
    ]);

    // Sender transfers 90 away — their own balance drops to 10% remaining (90% used).
    await commitGrantTransaction([
      { userId: sender._id.toString(), expectedBalance: 100, newBalance: 10 },
      { userId: recipient._id.toString(), expectedBalance: 0, newBalance: 90 },
    ]);
    await spendAlert.checkUserOwnThreshold(sender._id.toString());

    expect((await listNotificationsForUser(sender._id.toString())).notifications).toHaveLength(1);
    // The recipient received money, not spent it — no alert, and their own
    // totalReceived now covers the transfer (not a threshold crossing).
    await spendAlert.checkUserOwnThreshold(recipient._id.toString());
    expect((await listNotificationsForUser(recipient._id.toString())).notifications).toHaveLength(
      0,
    );
  });
});
