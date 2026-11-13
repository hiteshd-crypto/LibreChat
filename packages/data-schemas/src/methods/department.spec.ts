import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IRole } from '..';
import { createDepartmentMethods, DepartmentConflictError } from './department';
import { createSystemGrantMethods } from './systemGrant';
import { createRoleMethods } from './role';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let Role: mongoose.Model<IRole>;
let roleMethods: ReturnType<typeof createRoleMethods>;
let grantCapability: ReturnType<typeof createSystemGrantMethods>['grantCapability'];
let departmentMethods: ReturnType<typeof createDepartmentMethods>;
let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Role = mongoose.models.Role as mongoose.Model<IRole>;
  roleMethods = createRoleMethods(mongoose);
  ({ grantCapability } = createSystemGrantMethods(mongoose));
  departmentMethods = createDepartmentMethods(mongoose, {
    getAncestorRoleKeys: roleMethods.getAncestorRoleKeys,
    grantCapability,
  });
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

async function createTopLevelRole(name: string): Promise<IRole> {
  return roleMethods.createRoleByName({ name, permissions: {} } as Partial<IRole>);
}

describe('createDepartment', () => {
  it('wraps an existing top-level role into a Department', async () => {
    const root = await createTopLevelRole('Accounting');
    const department = await departmentMethods.createDepartment({
      name: 'Accounting',
      rootRoleKey: root.roleKey,
    });
    expect(department.name).toBe('Accounting');
    expect(department.rootRoleKey).toBe(root.roleKey);
  });

  it('rejects a rootRoleKey that does not exist', async () => {
    await expect(
      departmentMethods.createDepartment({ name: 'Ghost', rootRoleKey: 'does-not-exist' }),
    ).rejects.toThrow(/does not exist/i);
  });

  it('rejects a rootRoleKey that is not a top-level branch root', async () => {
    const root = await createTopLevelRole('IT');
    const child = await roleMethods.createRoleByName({
      name: 'IT Child',
      parentRole: root.roleKey,
      permissions: {},
    } as Partial<IRole>);
    await expect(
      departmentMethods.createDepartment({ name: 'IT Child Dept', rootRoleKey: child.roleKey }),
    ).rejects.toThrow(/not a top-level branch root/i);
  });

  it('rejects a duplicate rootRoleKey with a typed conflict error', async () => {
    const root = await createTopLevelRole('Sales');
    await departmentMethods.createDepartment({ name: 'Sales', rootRoleKey: root.roleKey });
    await expect(
      departmentMethods.createDepartment({ name: 'Sales Again', rootRoleKey: root.roleKey }),
    ).rejects.toThrow(DepartmentConflictError);
  });

  it('rejects a duplicate department name with a typed conflict error', async () => {
    const rootA = await createTopLevelRole('HR');
    const rootB = await createTopLevelRole('HR-2');
    await departmentMethods.createDepartment({
      name: 'Human Resources',
      rootRoleKey: rootA.roleKey,
    });
    await expect(
      departmentMethods.createDepartment({ name: 'Human Resources', rootRoleKey: rootB.roleKey }),
    ).rejects.toThrow(DepartmentConflictError);
  });
});

describe('listDepartments / getDepartmentByRootRoleKey', () => {
  it('lists every department, scoped by tenantId when given', async () => {
    const root = await createTopLevelRole('Marketing');
    await departmentMethods.createDepartment({ name: 'Marketing', rootRoleKey: root.roleKey });
    const all = await departmentMethods.listDepartments();
    expect(all.map((d) => d.name)).toContain('Marketing');
  });

  it('resolves a department by its root roleKey', async () => {
    const root = await createTopLevelRole('Legal');
    await departmentMethods.createDepartment({ name: 'Legal', rootRoleKey: root.roleKey });
    const found = await departmentMethods.getDepartmentByRootRoleKey(root.roleKey);
    expect(found?.name).toBe('Legal');
  });

  it('returns null for a root roleKey with no department', async () => {
    const found = await departmentMethods.getDepartmentByRootRoleKey('nonexistent');
    expect(found).toBeNull();
  });
});

describe('getDepartmentForRoleKey', () => {
  it('walks ancestors to the branch root and resolves its Department', async () => {
    const root = await createTopLevelRole('Engineering');
    const mid = await roleMethods.createRoleByName({
      name: 'Eng Manager',
      parentRole: root.roleKey,
      permissions: {},
    } as Partial<IRole>);
    const leaf = await roleMethods.createRoleByName({
      name: 'Eng IC',
      parentRole: mid.roleKey,
      permissions: {},
    } as Partial<IRole>);
    await departmentMethods.createDepartment({ name: 'Engineering', rootRoleKey: root.roleKey });

    const forRoot = await departmentMethods.getDepartmentForRoleKey(root.roleKey);
    const forMid = await departmentMethods.getDepartmentForRoleKey(mid.roleKey);
    const forLeaf = await departmentMethods.getDepartmentForRoleKey(leaf.roleKey);

    expect(forRoot?.name).toBe('Engineering');
    expect(forMid?.name).toBe('Engineering');
    expect(forLeaf?.name).toBe('Engineering');
  });

  it('returns null when the branch has no Department', async () => {
    const root = await createTopLevelRole('Unwrapped');
    const found = await departmentMethods.getDepartmentForRoleKey(root.roleKey);
    expect(found).toBeNull();
  });
});

describe('renameDepartment', () => {
  it('renames a department by id', async () => {
    const root = await createTopLevelRole('Ops');
    const department = await departmentMethods.createDepartment({
      name: 'Ops',
      rootRoleKey: root.roleKey,
    });
    const renamed = await departmentMethods.renameDepartment(
      String((department as unknown as { _id: unknown })._id),
      'Operations',
    );
    expect(renamed.name).toBe('Operations');
  });

  it('rejects a rename that collides with another department name', async () => {
    const rootA = await createTopLevelRole('Finance');
    const rootB = await createTopLevelRole('Finance-2');
    const deptA = await departmentMethods.createDepartment({
      name: 'Finance',
      rootRoleKey: rootA.roleKey,
    });
    await departmentMethods.createDepartment({ name: 'Treasury', rootRoleKey: rootB.roleKey });
    await expect(
      departmentMethods.renameDepartment(
        String((deptA as unknown as { _id: unknown })._id),
        'Treasury',
      ),
    ).rejects.toThrow(DepartmentConflictError);
  });
});

describe('deleteDepartment', () => {
  it('deletes only the Department label, leaving the underlying Role branch intact', async () => {
    const root = await createTopLevelRole('Support');
    const department = await departmentMethods.createDepartment({
      name: 'Support',
      rootRoleKey: root.roleKey,
    });
    await departmentMethods.deleteDepartment(
      String((department as unknown as { _id: unknown })._id),
    );

    const found = await departmentMethods.getDepartmentByRootRoleKey(root.roleKey);
    const stillExists = await Role.findOne({ roleKey: root.roleKey }).lean();
    expect(found).toBeNull();
    expect(stillExists).not.toBeNull();
  });

  it('marks the root role departmentExcluded so it is not re-wrapped on migration', async () => {
    const root = await createTopLevelRole('Legal-Dept');
    const department = await departmentMethods.createDepartment({
      name: 'Legal-Dept',
      rootRoleKey: root.roleKey,
    });
    await departmentMethods.deleteDepartment(
      String((department as unknown as { _id: unknown })._id),
    );

    const role = await Role.findOne({ roleKey: root.roleKey }).lean();
    expect(role?.departmentExcluded).toBe(true);
  });

  it('does not set departmentExcluded on an empty department (no rootRoleKey)', async () => {
    const department = await departmentMethods.createDepartment({ name: 'Empty Dept' });
    await departmentMethods.deleteDepartment(
      String((department as unknown as { _id: unknown })._id),
    );
    expect(await departmentMethods.listDepartments()).toHaveLength(0);
  });
});

describe('re-wrapping a role clears departmentExcluded', () => {
  it('createDepartment with rootRoleKey clears a prior exclusion', async () => {
    const root = await createTopLevelRole('Procurement');
    const department = await departmentMethods.createDepartment({
      name: 'Procurement',
      rootRoleKey: root.roleKey,
    });
    await departmentMethods.deleteDepartment(
      String((department as unknown as { _id: unknown })._id),
    );
    expect((await Role.findOne({ roleKey: root.roleKey }).lean())?.departmentExcluded).toBe(true);

    await departmentMethods.createDepartment({ name: 'Procurement', rootRoleKey: root.roleKey });
    expect((await Role.findOne({ roleKey: root.roleKey }).lean())?.departmentExcluded).toBe(false);
  });

  it('setDepartmentRootRole clears a prior exclusion on the claimed role', async () => {
    const root = await createTopLevelRole('Compliance');
    const wrapped = await departmentMethods.createDepartment({
      name: 'Compliance',
      rootRoleKey: root.roleKey,
    });
    await departmentMethods.deleteDepartment(String((wrapped as unknown as { _id: unknown })._id));
    expect((await Role.findOne({ roleKey: root.roleKey }).lean())?.departmentExcluded).toBe(true);

    const empty = await departmentMethods.createDepartment({ name: 'Compliance Shell' });
    await departmentMethods.setDepartmentRootRole(
      String((empty as unknown as { _id: unknown })._id),
      root.roleKey,
    );
    expect((await Role.findOne({ roleKey: root.roleKey }).lean())?.departmentExcluded).toBe(false);
  });
});
