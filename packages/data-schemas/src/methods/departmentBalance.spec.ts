import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { IBalance, IDepartment, IUser } from '..';
import { createDepartmentBalanceMethods } from './departmentBalance';

let mongoServer: MongoMemoryReplSet;
let Balance: mongoose.Model<IBalance>;
let Department: mongoose.Model<IDepartment>;
let User: mongoose.Model<IUser>;
let getDepartmentBalance: ReturnType<typeof createDepartmentBalanceMethods>['getDepartmentBalance'];
let incrementDepartmentBalance: ReturnType<
  typeof createDepartmentBalanceMethods
>['incrementDepartmentBalance'];
let commitDisbursementTransaction: ReturnType<
  typeof createDepartmentBalanceMethods
>['commitDisbursementTransaction'];
let migrateHeadBalancesToPool: ReturnType<
  typeof createDepartmentBalanceMethods
>['migrateHeadBalancesToPool'];

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoServer.getUri();

  const { createModels } = await import('~/models');
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  Balance = mongoose.models.Balance;
  Department = mongoose.models.Department;
  User = mongoose.models.User;

  ({
    getDepartmentBalance,
    incrementDepartmentBalance,
    commitDisbursementTransaction,
    migrateHeadBalancesToPool,
  } = createDepartmentBalanceMethods(mongoose));

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('getDepartmentBalance', () => {
  test('defaults to 0 when no pool record exists yet', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    expect(await getDepartmentBalance(departmentId)).toBe(0);
  });

  test('reads the stored balance when a pool record exists', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    await mongoose.models.DepartmentBalance.create({ department: departmentId, balance: 500 });
    expect(await getDepartmentBalance(departmentId)).toBe(500);
  });
});

describe('incrementDepartmentBalance', () => {
  test('upserts a pool record on the first increment', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    const result = await incrementDepartmentBalance(departmentId, 100);
    expect(result).toBe(100);
  });

  test('accumulates across repeated increments', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    await incrementDepartmentBalance(departmentId, 100);
    const second = await incrementDepartmentBalance(departmentId, 50);
    expect(second).toBe(150);
  });

  test('a negative amount decrements the pool', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    await incrementDepartmentBalance(departmentId, 100);
    const result = await incrementDepartmentBalance(departmentId, -40);
    expect(result).toBe(60);
  });
});

describe('commitDisbursementTransaction', () => {
  test('commits, conserving money: pool decrease exactly equals the sum of participant increases', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    await incrementDepartmentBalance(departmentId, 1000);
    const memberA = new mongoose.Types.ObjectId().toString();
    const memberB = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: memberA, tokenCredits: 10 });
    await Balance.create({ user: memberB, tokenCredits: 20 });

    const result = await commitDisbursementTransaction({
      departmentId,
      expectedPoolBalance: 1000,
      participants: [
        { userId: memberA, expectedBalance: 10, newBalance: 110 },
        { userId: memberB, expectedBalance: 20, newBalance: 120 },
      ],
    });

    expect(result).toEqual({
      status: 'committed',
      poolBalance: 800,
      balances: { [memberA]: 110, [memberB]: 120 },
    });
    expect(await getDepartmentBalance(departmentId)).toBe(800);
    expect((await Balance.findOne({ user: memberA }))?.tokenCredits).toBe(110);
    expect((await Balance.findOne({ user: memberB }))?.tokenCredits).toBe(120);
  });

  test('bumps each participant totalReceived by exactly their disbursed delta', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    await incrementDepartmentBalance(departmentId, 1000);
    const member = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: member, tokenCredits: 10, totalReceived: 10 });

    await commitDisbursementTransaction({
      departmentId,
      expectedPoolBalance: 1000,
      participants: [{ userId: member, expectedBalance: 10, newBalance: 110 }],
    });

    expect((await Balance.findOne({ user: member }))?.totalReceived).toBe(110);
  });

  test('aborts with pool_stale and writes nothing when the pool balance has drifted', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    await incrementDepartmentBalance(departmentId, 1000);
    const member = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: member, tokenCredits: 10 });

    const result = await commitDisbursementTransaction({
      departmentId,
      expectedPoolBalance: 500, // stale — actual pool is 1000
      participants: [{ userId: member, expectedBalance: 10, newBalance: 110 }],
    });

    expect(result).toEqual({
      status: 'pool_stale',
      expectedPoolBalance: 500,
      currentPoolBalance: 1000,
    });
    expect(await getDepartmentBalance(departmentId)).toBe(1000);
    expect((await Balance.findOne({ user: member }))?.tokenCredits).toBe(10);
  });

  test('aborts with pool_insufficient and writes nothing when the requested delta exceeds the pool', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    await incrementDepartmentBalance(departmentId, 50);
    const member = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: member, tokenCredits: 10 });

    const result = await commitDisbursementTransaction({
      departmentId,
      expectedPoolBalance: 50,
      participants: [{ userId: member, expectedBalance: 10, newBalance: 110 }], // delta 100 > pool 50
    });

    expect(result).toEqual({
      status: 'pool_insufficient',
      poolBalance: 50,
      requested: 100,
    });
    expect(await getDepartmentBalance(departmentId)).toBe(50);
    expect((await Balance.findOne({ user: member }))?.tokenCredits).toBe(10);
  });

  test('aborts with stale and writes nothing when a participant balance has drifted', async () => {
    const departmentId = new mongoose.Types.ObjectId().toString();
    await incrementDepartmentBalance(departmentId, 1000);
    const member = new mongoose.Types.ObjectId().toString();
    await Balance.create({ user: member, tokenCredits: 999 }); // changed since preview

    const result = await commitDisbursementTransaction({
      departmentId,
      expectedPoolBalance: 1000,
      participants: [{ userId: member, expectedBalance: 10, newBalance: 110 }],
    });

    expect(result).toEqual({
      status: 'stale',
      stale: [{ userId: member, expected: 10, current: 999 }],
    });
    expect(await getDepartmentBalance(departmentId)).toBe(1000);
    expect((await Balance.findOne({ user: member }))?.tokenCredits).toBe(999);
  });
});

describe('migrateHeadBalancesToPool', () => {
  test('moves a single head balance into the pool and zeroes it', async () => {
    const department = await Department.create({ name: 'Finance', rootRoleKey: 'FIN_HEAD' });
    const head = await User.create({
      email: 'head@example.com',
      role: 'FIN_HEAD',
      provider: 'local',
    });
    await Balance.create({ user: head._id, tokenCredits: 500 });

    const result = await migrateHeadBalancesToPool();

    expect(result.migrated).toBe(1);
    expect(result.totalMoved).toBe(500);
    expect(result.dryRun).toBe(false);
    expect((await Balance.findOne({ user: head._id }))?.tokenCredits).toBe(0);
    expect(await getDepartmentBalance(department._id.toString())).toBe(500);
  });

  test('sums multiple heads of the same department before moving', async () => {
    const department = await Department.create({ name: 'Sales', rootRoleKey: 'SALES_HEAD' });
    const headA = await User.create({
      email: 'a@example.com',
      role: 'SALES_HEAD',
      provider: 'local',
    });
    const headB = await User.create({
      email: 'b@example.com',
      role: 'SALES_HEAD',
      provider: 'local',
    });
    await Balance.create({ user: headA._id, tokenCredits: 100 });
    await Balance.create({ user: headB._id, tokenCredits: 250 });

    const result = await migrateHeadBalancesToPool();

    expect(result.totalMoved).toBe(350);
    expect((await Balance.findOne({ user: headA._id }))?.tokenCredits).toBe(0);
    expect((await Balance.findOne({ user: headB._id }))?.tokenCredits).toBe(0);
    expect(await getDepartmentBalance(department._id.toString())).toBe(350);
  });

  test('skips a department whose head balance sums to 0', async () => {
    await Department.create({ name: 'Empty Co', rootRoleKey: 'EMPTY_HEAD' });
    await User.create({ email: 'empty@example.com', role: 'EMPTY_HEAD', provider: 'local' });

    const result = await migrateHeadBalancesToPool();

    expect(result.migrated).toBe(0);
    expect(result.totalMoved).toBe(0);
  });

  test('a dry run reports the planned move but writes nothing', async () => {
    const department = await Department.create({ name: 'Ops', rootRoleKey: 'OPS_HEAD' });
    const head = await User.create({
      email: 'ops@example.com',
      role: 'OPS_HEAD',
      provider: 'local',
    });
    await Balance.create({ user: head._id, tokenCredits: 300 });

    const result = await migrateHeadBalancesToPool({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.migrated).toBe(1);
    expect(result.totalMoved).toBe(300);
    expect(result.planned.length).toBe(1);
    expect((await Balance.findOne({ user: head._id }))?.tokenCredits).toBe(300);
    expect(await getDepartmentBalance(department._id.toString())).toBe(0);
  });

  test('a second run is a true no-op (idempotent)', async () => {
    const department = await Department.create({ name: 'Legal', rootRoleKey: 'LEGAL_HEAD' });
    const head = await User.create({
      email: 'legal@example.com',
      role: 'LEGAL_HEAD',
      provider: 'local',
    });
    await Balance.create({ user: head._id, tokenCredits: 400 });

    await migrateHeadBalancesToPool();
    const second = await migrateHeadBalancesToPool();

    expect(second.migrated).toBe(0);
    expect(second.totalMoved).toBe(0);
    expect(await getDepartmentBalance(department._id.toString())).toBe(400);
  });
});
