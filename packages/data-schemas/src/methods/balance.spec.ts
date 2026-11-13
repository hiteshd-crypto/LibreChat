import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { IBalance } from '..';
import { createBalanceMethods } from './balance';
import { createModels } from '~/models';

let mongoServer: MongoMemoryReplSet;
let Balance: mongoose.Model<IBalance>;
let getBalancesByUserIds: ReturnType<typeof createBalanceMethods>['getBalancesByUserIds'];
let setBalanceInTransaction: ReturnType<typeof createBalanceMethods>['setBalanceInTransaction'];
let commitGrantTransaction: ReturnType<typeof createBalanceMethods>['commitGrantTransaction'];

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoServer.getUri();

  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  Balance = mongoose.models.Balance;

  ({ getBalancesByUserIds, setBalanceInTransaction, commitGrantTransaction } =
    createBalanceMethods(mongoose));

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('getBalancesByUserIds', () => {
  test("reads every listed user's current balance in one call", async () => {
    const userA = new mongoose.Types.ObjectId().toString();
    const userB = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: userA, tokenCredits: 500 });
    await Balance.create({ user: userB, tokenCredits: 25.5 });

    const balances = await getBalancesByUserIds([userA, userB]);

    expect(balances.get(userA)).toBe(500);
    expect(balances.get(userB)).toBe(25.5);
  });

  test('treats a user with no balance record as having 0 credits', async () => {
    const userId = new mongoose.Types.ObjectId().toString();

    const balances = await getBalancesByUserIds([userId]);

    expect(balances.get(userId)).toBe(0);
  });

  test('returns an empty map for an empty input without querying', async () => {
    const balances = await getBalancesByUserIds([]);
    expect(balances.size).toBe(0);
  });
});

describe('setBalanceInTransaction', () => {
  test('sets the balance to exactly the given value within the session', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: userId, tokenCredits: 10 });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await setBalanceInTransaction(session, userId, 33.333333);
      });
    } finally {
      await session.endSession();
    }

    const stored = await Balance.findOne({ user: userId });
    expect(stored?.tokenCredits).toBe(33.333333);
  });

  test('creates a balance record when none existed yet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await setBalanceInTransaction(session, userId, 42);
      });
    } finally {
      await session.endSession();
    }

    const stored = await Balance.findOne({ user: userId });
    expect(stored?.tokenCredits).toBe(42);
  });

  test('leaves every balance unchanged when the transaction is aborted', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: userId, tokenCredits: 10 });

    const session = await mongoose.startSession();
    try {
      await expect(
        session.withTransaction(async () => {
          await setBalanceInTransaction(session, userId, 99);
          throw new Error('abort for test');
        }),
      ).rejects.toThrow('abort for test');
    } finally {
      await session.endSession();
    }

    const stored = await Balance.findOne({ user: userId });
    expect(stored?.tokenCredits).toBe(10);
  });
});

describe('commitGrantTransaction', () => {
  test('commits every participant atomically when none are stale', async () => {
    const root = new mongoose.Types.ObjectId().toString();
    const recipient = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: root, tokenCredits: 5 });
    await Balance.create({ user: recipient, tokenCredits: 10 });

    const result = await commitGrantTransaction([
      { userId: root, expectedBalance: 5, newBalance: 30 },
      { userId: recipient, expectedBalance: 10, newBalance: 35 },
    ]);

    expect(result).toEqual({
      status: 'committed',
      balances: { [root]: 30, [recipient]: 35 },
    });
    expect((await Balance.findOne({ user: root }))?.tokenCredits).toBe(30);
    expect((await Balance.findOne({ user: recipient }))?.tokenCredits).toBe(35);
  });

  test('rejects and writes nothing when a participant balance no longer matches expected', async () => {
    const root = new mongoose.Types.ObjectId().toString();
    const recipient = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: root, tokenCredits: 5 });
    await Balance.create({ user: recipient, tokenCredits: 999 }); // changed since preview

    const result = await commitGrantTransaction([
      { userId: root, expectedBalance: 5, newBalance: 30 },
      { userId: recipient, expectedBalance: 10, newBalance: 35 },
    ]);

    expect(result).toEqual({
      status: 'stale',
      stale: [{ userId: recipient, expected: 10, current: 999 }],
    });
    // The whole commit aborted — even the non-stale root participant must be untouched.
    expect((await Balance.findOne({ user: root }))?.tokenCredits).toBe(5);
    expect((await Balance.findOne({ user: recipient }))?.tokenCredits).toBe(999);
  });

  test('a second commit against the same expected balances fails once the first has applied', async () => {
    const root = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: root, tokenCredits: 5 });
    const participants = [{ userId: root, expectedBalance: 5, newBalance: 30 }];

    const first = await commitGrantTransaction(participants);
    const second = await commitGrantTransaction(participants);

    expect(first.status).toBe('committed');
    expect(second).toEqual({
      status: 'stale',
      stale: [{ userId: root, expected: 5, current: 30 }],
    });
  });

  test('treats a participant with no prior balance record as expecting 0', async () => {
    const root = new mongoose.Types.ObjectId().toString();

    const result = await commitGrantTransaction([
      { userId: root, expectedBalance: 0, newBalance: 25 },
    ]);

    expect(result).toEqual({ status: 'committed', balances: { [root]: 25 } });
  });
});
