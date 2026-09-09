import mongoose from 'mongoose';
import { SystemRoles } from 'librechat-data-provider';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IRole, IUser } from '..';
import { createRoleMethods } from './role';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let Role: mongoose.Model<IRole>;
let User: mongoose.Model<IUser>;
let mongoServer: MongoMemoryServer;
let migrateRoleKeys: ReturnType<typeof createRoleMethods>['migrateRoleKeys'];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Role = mongoose.models.Role as mongoose.Model<IRole>;
  User = mongoose.models.User as mongoose.Model<IUser>;
  migrateRoleKeys = createRoleMethods(mongoose).migrateRoleKeys;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([
    mongoose.connection.collection('roles').deleteMany({}),
    mongoose.connection.collection('users').deleteMany({}),
    mongoose.connection.collection('systemgrants').deleteMany({}),
  ]);
});

/** Inserts legacy (nameonly) data via the raw driver so the pre('validate') hook does not fire. */
async function seedLegacy() {
  await mongoose.connection.collection('roles').insertMany([
    { name: 'ADMIN', permissions: {}, parentRole: null },
    { name: 'USER', permissions: {}, parentRole: null },
    { name: 'SUPERVISOR', permissions: {}, parentRole: null },
    { name: 'SALES_MGR', permissions: {}, parentRole: 'SUPERVISOR' },
    { name: 'SALES_EMP', permissions: {}, parentRole: 'SALES_MGR' },
  ]);
  await mongoose.connection
    .collection('users')
    .insertOne({ email: 'e@x.io', provider: 'local', role: 'SALES_MGR' });
  await mongoose.connection.collection('systemgrants').insertOne({
    principalType: 'role',
    principalId: 'SALES_MGR',
    capability: 'read:subordinates',
  });
}

describe('migrateRoleKeys', () => {
  it('backfills roleKey (name for system, _id for custom) and rewrites parentRole to keys', async () => {
    await seedLegacy();
    await migrateRoleKeys();

    const admin = await Role.findOne({ name: 'ADMIN' }).lean();
    const sup = await Role.findOne({ name: 'SUPERVISOR' }).lean();
    const mgr = await Role.findOne({ name: 'SALES_MGR' }).lean();
    const emp = await Role.findOne({ name: 'SALES_EMP' }).lean();

    expect(admin?.roleKey).toBe('ADMIN');
    expect(sup?.roleKey).toBe(String(sup?._id));
    expect(mgr?.parentRole).toBe(sup?.roleKey);
    expect(emp?.parentRole).toBe(mgr?.roleKey);
  });

  it('rewrites user.role and ROLE-principal ids from name to key', async () => {
    await seedLegacy();
    await migrateRoleKeys();

    const mgr = await Role.findOne({ name: 'SALES_MGR' }).lean();
    const user = await User.findOne({ email: 'e@x.io' }).lean();
    const grant = await mongoose.connection
      .collection('systemgrants')
      .findOne({ capability: 'read:subordinates' });

    expect(user?.role).toBe(mgr?.roleKey);
    expect(grant?.principalId).toBe(mgr?.roleKey);
  });

  it('is a no-op on a second run', async () => {
    await seedLegacy();
    await migrateRoleKeys();
    const second = await migrateRoleKeys();
    expect(second).toEqual(
      expect.objectContaining({ keyed: 0, parentLinks: 0, users: 0, principals: 0 }),
    );
  });

  it('dryRun reports the plan without writing', async () => {
    await seedLegacy();
    const res = await migrateRoleKeys({ dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.planned?.length ?? 0).toBeGreaterThan(0);
    const mgr = await mongoose.connection.collection('roles').findOne({ name: 'SALES_MGR' });
    expect(mgr?.roleKey).toBeUndefined();
  });

  it('treats two top-level roles with the same name as an index collision after migration', async () => {
    await mongoose.connection.collection('roles').insertMany([
      { name: 'ADMIN', permissions: {}, parentRole: null },
      { name: 'USER', permissions: {}, parentRole: null },
      { name: 'DUP', permissions: {}, parentRole: null },
    ]);
    await migrateRoleKeys();
    await expect(Role.create({ name: 'DUP', permissions: {}, parentRole: null })).rejects.toThrow(
      /duplicate key/i,
    );
    expect(SystemRoles.ADMIN).toBe('ADMIN');
  });
});
