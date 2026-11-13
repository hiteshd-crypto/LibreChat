import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IDepartment, IRole } from '..';
import { SystemCapabilities } from '../admin/capabilities';
import { createSystemGrantMethods } from './systemGrant';
import { createDepartmentMethods } from './department';
import { createRoleMethods } from './role';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let Department: mongoose.Model<IDepartment>;
let Role: mongoose.Model<IRole>;
let migrateDepartments: ReturnType<typeof createDepartmentMethods>['migrateDepartments'];
let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Department = mongoose.models.Department as mongoose.Model<IDepartment>;
  Role = mongoose.models.Role as mongoose.Model<IRole>;
  const roleMethods = createRoleMethods(mongoose);
  const { grantCapability } = createSystemGrantMethods(mongoose);
  migrateDepartments = createDepartmentMethods(mongoose, {
    getAncestorRoleKeys: roleMethods.getAncestorRoleKeys,
    grantCapability,
  }).migrateDepartments;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([
    mongoose.connection.collection('roles').deleteMany({}),
    mongoose.connection.collection('departments').deleteMany({}),
    mongoose.connection.collection('systemgrants').deleteMany({}),
  ]);
});

/** Inserts top-level custom roles directly, with roleKey already keyed (post role-key migration). */
async function seedTopLevelRoles() {
  await Role.create([
    { name: 'ADMIN', roleKey: 'ADMIN', permissions: {}, parentRole: null },
    { name: 'USER', roleKey: 'USER', permissions: {}, parentRole: null },
    { name: 'admin', roleKey: 'admin-casing-check', permissions: {}, parentRole: null },
    { name: 'Accounting', roleKey: 'accounting-key', permissions: {}, parentRole: null },
    { name: 'IT', roleKey: 'it-key', permissions: {}, parentRole: null },
  ]);
}

describe('migrateDepartments', () => {
  it('wraps every top-level custom role in a Department and grants DEPARTMENT_HEAD, excluding system roles case-insensitively', async () => {
    await seedTopLevelRoles();
    const result = await migrateDepartments();

    expect(result.dryRun).toBe(false);
    expect(result.created).toBe(2);
    expect(result.granted).toBe(2);

    const departments = await Department.find({}).lean();
    expect(departments.map((d) => d.rootRoleKey).sort()).toEqual(['accounting-key', 'it-key']);

    const adminDept = await Department.findOne({ rootRoleKey: 'ADMIN' }).lean();
    const userDept = await Department.findOne({ rootRoleKey: 'USER' }).lean();
    const caseDept = await Department.findOne({ rootRoleKey: 'admin-casing-check' }).lean();
    expect(adminDept).toBeNull();
    expect(userDept).toBeNull();
    expect(caseDept).toBeNull();

    const grant = await mongoose.connection.collection('systemgrants').findOne({
      principalId: 'accounting-key',
      capability: SystemCapabilities.DEPARTMENT_HEAD,
    });
    expect(grant).not.toBeNull();
  });

  it('is idempotent — a second run creates nothing new', async () => {
    await seedTopLevelRoles();
    await migrateDepartments();
    const second = await migrateDepartments();

    expect(second.created).toBe(0);
    expect(second.granted).toBe(0);
    const departments = await Department.find({}).lean();
    expect(departments).toHaveLength(2);
  });

  it('skips a branch that already has a Department, but still backfills a missing grant', async () => {
    await seedTopLevelRoles();
    const roleMethods = createRoleMethods(mongoose);
    const { grantCapability } = createSystemGrantMethods(mongoose);
    const deps = { getAncestorRoleKeys: roleMethods.getAncestorRoleKeys, grantCapability };
    const { createDepartment } = createDepartmentMethods(mongoose, deps);
    await createDepartment({ name: 'Accounting', rootRoleKey: 'accounting-key' });

    const result = await migrateDepartments();
    expect(result.created).toBe(1); // only IT is new
    expect(result.granted).toBe(2); // both still need the grant backfilled
  });

  it('dryRun reports the plan without writing', async () => {
    await seedTopLevelRoles();
    const result = await migrateDepartments({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.planned.length).toBeGreaterThan(0);
    const departments = await Department.find({}).lean();
    expect(departments).toHaveLength(0);
  });

  it('does not recreate a Department for a role an admin deliberately unwrapped', async () => {
    await seedTopLevelRoles();
    const roleMethods = createRoleMethods(mongoose);
    const { grantCapability } = createSystemGrantMethods(mongoose);
    const deps = { getAncestorRoleKeys: roleMethods.getAncestorRoleKeys, grantCapability };
    const { createDepartment, deleteDepartment } = createDepartmentMethods(mongoose, deps);

    const department = await createDepartment({
      name: 'Accounting',
      rootRoleKey: 'accounting-key',
    });
    await deleteDepartment(String((department as unknown as { _id: unknown })._id));

    const result = await migrateDepartments();
    expect(result.created).toBe(1); // only IT, Accounting stays unwrapped

    const accountingDept = await Department.findOne({ rootRoleKey: 'accounting-key' }).lean();
    expect(accountingDept).toBeNull();
  });

  it('still wraps a genuinely new top-level role even while another stays excluded', async () => {
    await seedTopLevelRoles();
    const roleMethods = createRoleMethods(mongoose);
    const { grantCapability } = createSystemGrantMethods(mongoose);
    const deps = { getAncestorRoleKeys: roleMethods.getAncestorRoleKeys, grantCapability };
    const { createDepartment, deleteDepartment } = createDepartmentMethods(mongoose, deps);

    const department = await createDepartment({
      name: 'Accounting',
      rootRoleKey: 'accounting-key',
    });
    await deleteDepartment(String((department as unknown as { _id: unknown })._id));

    await Role.create({
      name: 'Logistics',
      roleKey: 'logistics-key',
      permissions: {},
      parentRole: null,
    });

    const result = await migrateDepartments();
    expect(result.created).toBe(2); // IT and Logistics; Accounting stays excluded

    const logisticsDept = await Department.findOne({ rootRoleKey: 'logistics-key' }).lean();
    const accountingDept = await Department.findOne({ rootRoleKey: 'accounting-key' }).lean();
    expect(logisticsDept).not.toBeNull();
    expect(accountingDept).toBeNull();
  });
});
